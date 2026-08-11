'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { assertVenueBillingActive } from '@/features/billing/gate';
import { sendInviteEmail } from './invite-mail';
import { inviteSchema, revokeInviteSchema, resendInviteSchema } from './schemas';
import { canGrantRoles, type VenueRole } from './roles';

export interface ActionState {
  ok: boolean;
  error?: string;
  message?: string;
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
 * Invite a user to a venue with a set of roles (decision #20/#24). Security
 * checklist applied: session verified server-side, AAL2 enforced (role grant
 * is sensitive), caller's venue role + escalation guard checked in the app AND
 * again by RLS on the invite insert, all input through Zod.
 *
 * The invite row — written through the user-scoped client so RLS re-validates —
 * is inserted FIRST and is what actually grants access when the invitee accepts
 * on first login; the invitee is provisioned + e-mailed via the service role
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
  const sent = await sendInviteEmail(email);
  if (!sent.ok && sent.reason === 'provision') {
    return { ok: false, error: "Couldn't send the invite. Try again." };
  }

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

  const parsed = resendInviteSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: 'Invalid invite.' };

  // Read through RLS: only a manager/finance of the invite's venue sees the row.
  const supabase = await createClient();
  const { data: invite } = await supabase
    .from('invites')
    .select('id, email, venue_id, accepted_at')
    .eq('id', parsed.data.inviteId)
    .maybeSingle();
  if (!invite) return { ok: false, error: "Couldn't find the invite." };
  if (invite.accepted_at) {
    return { ok: false, error: 'This invite was already accepted.' };
  }
  // Same soft-block as inviting (#32): a canceled/lapsed venue grows no team.
  const billingBlocked = await assertVenueBillingActive(invite.venue_id);
  if (billingBlocked) return { ok: false, error: billingBlocked.message };

  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from('invites')
    .update({ expires_at: expiresAt }, { count: 'exact' })
    .eq('id', invite.id);
  if (error || !count) {
    return { ok: false, error: "Couldn't resend the invite (no access)." };
  }

  const sent = await sendInviteEmail(invite.email);
  if (!sent.ok) return { ok: false, error: "Couldn't send the invite e-mail. Try again." };

  revalidatePath('/admin/team');
  return { ok: true, message: `Invite re-sent to ${invite.email}.` };
}

/** Accept the caller's own pending invites (used by the banner). */
export async function acceptInvitesAction(): Promise<ActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const supabase = await createClient();
  const { error } = await supabase.rpc('accept_pending_invites');
  if (error) {
    return { ok: false, error: "Couldn't accept the invite." };
  }

  revalidatePath('/app');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Invite accepted.' };
}
