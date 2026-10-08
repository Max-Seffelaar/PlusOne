'use server';

import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getMyProfile, getSessionUser } from '@/lib/auth/context';
import { assertVenueBillingActive } from '@/features/billing/gate';
import { sendInviteEmail } from './invite-mail';
import type { TeamMailContent } from '@/features/mail/templates';
import { inviteMailCapReached } from '@/features/mail/limits';
import { notifyInviteDeclined } from '@/features/mail/declined';
import { inviteSchema, revokeInviteSchema, resendInviteSchema, respondInviteSchema } from './schemas';
import { canGrantRoles, type VenueRole } from './roles';
import { isDemoReviewUser } from './review-window';
import { t } from '@/lib/i18n';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
  /** `not_open`: the invite is gone (expired, declined, accepted, revoked or not
   *  theirs). The UI drops the card instead of leaving a dead button. */
  code?: 'not_open';
}

const INVITE_TTL_DAYS = 7;

// Loads the caller's roles at a venue (RLS: the user always sees their own
// membership). Empty when not a member.
async function callerRolesAt(venueId: string, userId: string): Promise<VenueRole[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userId)
    .maybeSingle();
  return data?.roles ?? [];
}

/**
 * Display context for the team mail an EXISTING account gets (Mail-infra F0):
 * the caller's own name (RLS: own profile) and the venue name (RLS: member).
 * Null when the venue name can't be read; sendInviteEmail then keeps the
 * magic-link path rather than send a mail with a hole in it.
 */
async function teamMailContext(
  venueId: string,
  template: 'join' | 'resend'
): Promise<TeamMailContent | null> {
  const supabase = await createClient();
  const [profile, { data: venue }] = await Promise.all([
    getMyProfile(),
    supabase.from('venues').select('name').eq('id', venueId).maybeSingle(),
  ]);
  if (!venue?.name) return null;
  const base = { venueId, inviterName: profile?.full_name ?? null, companyName: venue.name };
  return template === 'join'
    ? { template: 'team_join', ...base }
    : { template: 'team_resend', kind: 'join', ...base };
}

/**
 * Invite a user to a venue with a set of roles (decision #20/#24). Security
 * checklist applied: session verified server-side (role-only — no AAL2
 * requirement, MFA is optional), caller's venue role + escalation guard checked in the app AND
 * again by RLS on the invite insert, all input through Zod.
 *
 * The invite row — written through the user-scoped client so RLS re-validates —
 * is inserted FIRST and is what grants access once the invitee explicitly
 * accepts it (Home banner or the onboarding invite step; login accepts nothing,
 * z8uq9m2yvp); the invitee is provisioned + e-mailed via the service role
 * (inviteUserByEmail for a new address, a magic-link login for one that already
 * exists — invite-only, no public signups) only AFTER that insert succeeds. A
 * denied or conflicting insert (e.g. an already-open invite) must never leave a
 * live auth account + e-mail behind with no invite record to redeem it
 * (86ey9ea00 #54); sendInviteEmail is safe to retry, so a later provisioning
 * failure is recoverable via resendInviteAction. The audit trigger records the
 * invite.
 */
export async function inviteUserAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };
  // The store-review demo account never invites (86ey6bfug). The real stop is
  // the invites trigger (20260925130100_review_demo_no_invites.sql, 42501 for
  // any invite into the demo venue); this only swaps its generic "Couldn't
  // record the invite." for copy a reviewer reads as a restriction, not a bug.
  if (isDemoReviewUser(user)) return { ok: false, error: t.auth.demoNoInvites };

  const parsed = inviteSchema.safeParse({
    venueId: formData.get('venueId'),
    email: formData.get('email'),
    roles: formData.getAll('roles'),
    defaultQuota: formData.get('defaultQuota'),
    eventIds: formData.getAll('eventIds'),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }
  const { venueId, email, roles, defaultQuota, eventIds } = parsed.data;
  const typedRoles = roles as VenueRole[];

  // MFA is optional (#20 refinement 2026-07-02): no AAL2 assertion — the venue
  // role check below + RLS (invites_insert, role-only) are the boundary.

  // App-layer authority + escalation guard (RLS is the real boundary).
  const callerRoles = await callerRolesAt(venueId, user.id);
  if (!canGrantRoles(callerRoles, typedRoles)) {
    return { ok: false, error: "You can't grant these roles here." };
  }
  // Soft-block (#32 refinement): a canceled venue / lapsed unpaid trial grows
  // no team; existing members keep working.
  const billingBlocked = await assertVenueBillingActive(venueId);
  if (billingBlocked) return { ok: false, error: billingBlocked.message };
  // Daily invitation-mail cap per company (decision Max 2026-10-07): refuse
  // before anything is created, so no invite row is left without its mail.
  if (await inviteMailCapReached(venueId)) return { ok: false, error: t.auth.inviteMailCapReached };
  // Event-organizer scope is an admin-only grant (mirrors assignOrganizer, #6/#24);
  // RLS (invites_insert) re-enforces this, but check up front for a clear message.
  if (eventIds.length > 0 && !callerRoles.includes('admin')) {
    return { ok: false, error: 'Only an admin can link someone to events.' };
  }

  // 1) Record the invite through the user-scoped client FIRST → RLS enforces
  //    manager-role + escalation + invited_by = self once more. Nothing is
  //    provisioned or e-mailed until this succeeds (#54).
  const supabase = await createClient();

  // Keep only event ids that actually belong to this venue (RLS already scopes
  // the read to the caller's venues). Defends against a stale/cross-venue id; the
  // acceptance RPC filters again, so this is belt-and-braces for a clean store.
  let validEventIds: string[] = [];
  if (eventIds.length > 0) {
    const { data: events } = await supabase
      .from('events')
      .select('id')
      .eq('venue_id', venueId)
      .in('id', eventIds);
    validEventIds = (events ?? []).map((e) => e.id);
  }

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error: inviteError } = await supabase.from('invites').insert({
    venue_id: venueId,
    email,
    roles: typedRoles,
    invited_by: user.id,
    expires_at: expiresAt,
    // Seeded as the member's venue default quota on acceptance (#4); null = none.
    default_quota: defaultQuota ?? null,
    // Event-organizer scope granted on acceptance (#6/#24); [] = venue roles only.
    event_ids: validEventIds,
  });

  if (inviteError) {
    if (inviteError.code === '23505') {
      return { ok: false, error: 'There’s already an open invite for this email.' };
    }
    console.error('inviteUser: invite insert failed', inviteError.message);
    return { ok: false, error: "Couldn't record the invite." };
  }

  // 2) Only now provision the auth identity AND notify the invitee by e-mail
  //    (invite-only, no public signups — #20). The invite row above is what
  //    actually grants access — a transient notify failure for an EXISTING
  //    account must not surface as a hard error; sendInviteEmail can be
  //    retried via resendInviteAction either way.
  const existingAccountMail = (await teamMailContext(venueId, 'join')) ?? undefined;
  const sent = await sendInviteEmail(email, { existingAccountMail, mailCapVenueId: venueId });
  if (!sent.ok && sent.reason === 'provision') {
    return { ok: false, error: "Couldn't send the invite. Try again." };
  }
  // The company's daily cap, hit at send time (a race with the pre-check
  // above): no mail went out, so never report "Invite sent". The invite row
  // stays; a resend tomorrow delivers it.
  if (!sent.ok && sent.reason === 'cap') return { ok: false, error: t.auth.inviteMailCapReached };
  // 'recent' (a mail reached this address under a minute ago) is reported as
  // sent (review round 2). Since one invite mail (z8uq9m2yvp) a new address
  // hits the same window, and the answer stays the same for both, so it never
  // tells the inviter whether the address has an account.

  revalidatePath('/admin/team');
  return { ok: true, message: `Invite sent to ${email}.` };
}

/** Cancel a pending invite (RLS enforces manager + escalation, role-only). */
export async function revokeInviteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = revokeInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: 'Invalid invite.' };

  const supabase = await createClient();
  const { error, count } = await supabase
    .from('invites')
    .delete({ count: 'exact' })
    .eq('id', parsed.data.inviteId);

  if (error || !count) {
    return { ok: false, error: "Couldn't cancel the invite (no access, or already accepted)." };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: 'Invite canceled.' };
}

/**
 * Resend a pending invite (T8, 86ey4j1mu): give it a fresh 7-day expiry and
 * e-mail the invitee again. The expiry bump runs through the USER-scoped client
 * so RLS (invites_update_resend — manager role, pending only, escalation guard,
 * ≤30 days; migration 20260707113000) is the boundary; the audit trigger records
 * the update. Works for expired invites too — a resend re-opens the window.
 */
export async function resendInviteAction(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };
  // Same demo refusal as inviting (86ey6bfug): the demo venue holds no invites
  // to resend, but the reviewer should never see "Couldn't find the invite.".
  if (isDemoReviewUser(user)) return { ok: false, error: t.auth.demoNoInvites };

  const parsed = resendInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: 'Invalid invite.' };

  // Read through RLS: only a manager/finance of the invite's venue sees the row.
  const supabase = await createClient();
  const { data: invite } = await supabase
    .from('invites')
    .select('id, email, venue_id, accepted_at, declined_at')
    .eq('id', parsed.data.inviteId)
    .maybeSingle();
  if (!invite) return { ok: false, error: "Couldn't find the invite." };
  if (invite.accepted_at) {
    return { ok: false, error: 'This invite was already accepted.' };
  }
  // A declined invite is closed (RLS refuses the expiry bump too); a new
  // invite is the way to ask again.
  if (invite.declined_at) {
    return { ok: false, error: t.auth.inviteDeclined };
  }
  // Same soft-block as inviting (#32): a canceled/lapsed venue grows no team.
  const billingBlocked = await assertVenueBillingActive(invite.venue_id);
  if (billingBlocked) return { ok: false, error: billingBlocked.message };
  if (await inviteMailCapReached(invite.venue_id)) return { ok: false, error: t.auth.inviteMailCapReached };

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('invites')
    .update({ expires_at: expiresAt }, { count: 'exact' })
    .eq('id', invite.id);
  if (error || !count) {
    return { ok: false, error: "Couldn't resend the invite (no access)." };
  }

  const existingAccountMail = (await teamMailContext(invite.venue_id, 'resend')) ?? undefined;
  const sent = await sendInviteEmail(invite.email, { existingAccountMail, mailCapVenueId: invite.venue_id });
  // 'recent' counts as re-sent (review round 2): the address had a mail under
  // a minute ago. Kept as before so the answer never depends on whether the
  // address has an account. The daily cap keeps its own copy.
  if (!sent.ok && sent.reason !== 'recent') {
    if (sent.reason === 'cap') return { ok: false, error: t.auth.inviteMailCapReached };
    return { ok: false, error: "Couldn't send the invite e-mail. Try again." };
  }

  revalidatePath('/admin/team');
  return { ok: true, message: `Invite re-sent to ${invite.email}.` };
}

/**
 * Accept ONE of the caller's own open invites (z8uq9m2yvp): the only way an
 * invite, team or crew, ever becomes access. Login, consent and dev-login accept
 * nothing. Called from the Home banner and the onboarding invite step, once per
 * invite. accept_invite() acts only on an invite addressed to the caller's own
 * auth e-mail and answers false when it is no longer open.
 */
export async function acceptInviteAction(inviteId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };
  const parsed = respondInviteSchema.safeParse({ inviteId });
  if (!parsed.success) return { ok: false, error: t.shared.invites.notOpen, code: 'not_open' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invite', { p_invite_id: parsed.data.inviteId });
  if (error) {
    console.error('acceptInvite: rpc failed', error.code);
    return { ok: false, error: "Couldn't accept the invite." };
  }
  if (!data) return { ok: false, error: t.shared.invites.notOpen, code: 'not_open' };

  revalidatePath('/app');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Invite accepted.' };
}

/**
 * Decline ONE of the caller's own open invites. The database closes it
 * (decline_invite, true only on the open -> declined transition), then the two
 * decline mails go out, once: the inviter hears which address declined (the
 * address as typed on the invite, never a profile name), the decliner gets a
 * confirmation. The mails run in `after()`, so the invitee never waits on the
 * mail provider; they are best effort and never turn a recorded decline into an
 * error. Only the onboarding page reads the invite list on the server (the
 * banner refetches client-side), so that is the one path to revalidate: a decline
 * changes no identity, membership or layout data.
 */
export async function declineInviteAction(inviteId: string): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };
  const parsed = respondInviteSchema.safeParse({ inviteId });
  if (!parsed.success) return { ok: false, error: t.shared.invites.notOpen, code: 'not_open' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('decline_invite', { p_invite_id: parsed.data.inviteId });
  if (error) {
    console.error('declineInvite: rpc failed', error.code);
    return { ok: false, error: t.shared.invites.declineError };
  }
  if (!data) return { ok: false, error: t.shared.invites.notOpen, code: 'not_open' };

  const declinedId = parsed.data.inviteId;
  after(() => notifyInviteDeclined(declinedId));

  revalidatePath('/onboarding');
  return { ok: true, message: 'Invite declined.' };
}
