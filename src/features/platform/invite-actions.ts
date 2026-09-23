'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import { sendInviteEmail } from '@/features/auth/invite-mail';
import { betaInviteSchema, platformInviteIdSchema } from './schemas';

/**
 * Open-beta customer invites (P-03, z8uq9m0tnv).
 *
 * A platform admin invites a customer with nothing but an e-mail address. We
 * create NO venue and NO `public.invites` row: the invitee self-onboards
 * through the existing wizard (own company, own terms, `trialing`). The
 * `platform_invites` row is the outreach record and the funnel source.
 *
 * Security checklist (CLAUDE.md, every item deliberate):
 *  - Session verified server-side via `supabase.auth.getUser()`.
 *  - Authority is `is_platform_admin()`, enforced by RLS on every statement
 *    below — all of them run through the USER-SCOPED client. The app-layer
 *    `is_platform_admin()` probe is a convenience for a clear message, not the
 *    boundary; if it were ever wrong, the insert/update still fails closed.
 *  - All input through Zod (`betaInviteSchema` / `platformInviteIdSchema`).
 *  - Rate limited in the database (`consume_platform_invite_throttle`), so a
 *    stolen session cannot mail-bomb; invite + resend share one budget.
 *  - No PII in logs: we log the Postgres message, never the address.
 *  - Errors to the client are generic and identical whether or not the caller
 *    is a platform admin, so the action is not an existence oracle.
 *
 * SERVICE ROLE — where and why: exactly one place, `sendInviteEmail()` from
 * `@/features/auth/invite-mail`. Supabase's `auth.admin.inviteUserByEmail` is a
 * service-role-only API (provisioning an auth identity), and the magic-link
 * fallback for an already-confirmed address uses a bare anon client. Nothing in
 * `public` is ever touched with the service client here: the invite row is
 * written through the user-scoped client precisely so RLS stays the boundary.
 * Ordering mirrors 86ey9ea00 #54 — the row FIRST, the mail only after it
 * lands, so a denied or duplicate insert never leaves a provisioned account
 * behind with no record of why it exists.
 */

export interface PlatformActionState {
  ok: boolean;
  error?: string;
  message?: string;
}

/** Same wording for "not a platform admin" and "row not visible" on purpose. */
const NOT_ALLOWED = "You don't have access to this.";
const GENERIC_FAILURE = 'Something went wrong. Try again.';

/**
 * The mail is the whole deliverable here — unlike a crew invite, the row grants
 * nothing, so "row written, mail not delivered" is a FAILURE the operator has to
 * see. It is also recoverable: the row holds the unique-index slot, so a plain
 * retry of the invite would only ever answer "already an open invite". Every
 * undelivered path therefore names Resend as the way out instead of "try again".
 */
const MAIL_FAILED_USE_RESEND =
  'Invite recorded, but the email could not be delivered. Use Resend to try again.';
const MAIL_BUDGET_USE_RESEND =
  'Invite recorded, but the hourly email limit is reached. Use Resend a bit later.';
const RESEND_MAIL_FAILED = "Couldn't send the invite email. Try again in a moment.";
const RESEND_RATE_LIMITED = 'Too many invite emails just now. Try again in a bit.';

/** App-layer convenience check; RLS is the real gate on every statement. */
async function callerIsPlatformAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_platform_admin');
  if (error) return false;
  return data === true;
}

type MailBudget = 'ok' | 'limited' | 'denied';

/**
 * Consumes one unit of the per-admin outbound-mail budget. Kept distinct from
 * "denied" (the RPC raises 42501 for a non-platform-admin) so a caller without
 * access is never told they hit a rate limit — that would be an oracle, and it
 * contradicts the uniform NOT_ALLOWED the other actions return.
 */
async function consumeMailBudget(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<MailBudget> {
  const { data, error } = await supabase.rpc('consume_platform_invite_throttle');
  if (error) return error.code === '42501' ? 'denied' : 'limited';
  return data === true ? 'ok' : 'limited';
}

/** Invite a customer to the open beta. */
export async function inviteBetaCustomerAction(
  _prev: PlatformActionState,
  formData: FormData
): Promise<PlatformActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = betaInviteSchema.safeParse({
    email: formData.get('email'),
    note: formData.get('note') ?? undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check your details.' };
  }
  const { email, note } = parsed.data;

  const supabase = await createClient();
  if (!(await callerIsPlatformAdmin(supabase))) return { ok: false, error: NOT_ALLOWED };

  // 1) Record the outreach FIRST, through the user-scoped client so RLS
  //    (platform_invites_insert) re-validates platform-admin + invited_by.
  const { error: insertError } = await supabase.from('platform_invites').insert({
    email,
    note,
    invited_by: user.id,
  });

  if (insertError) {
    if (insertError.code === '23505') {
      return { ok: false, error: 'There’s already an open invite for this email.' };
    }
    // Message only — the address never reaches the logs.
    console.error('inviteBetaCustomer: insert failed', insertError.message);
    return { ok: false, error: GENERIC_FAILURE };
  }

  // 2) Budget is consumed immediately before the mail, never before the
  //    validation and the insert — a rejected address or a duplicate must not
  //    eat an hour's worth of somebody's outbound quota.
  const budget = await consumeMailBudget(supabase);
  if (budget !== 'ok') {
    // 'denied' is unreachable here (the probe above already passed), but do not
    // report a rate limit for it either way.
    return {
      ok: false,
      error: budget === 'denied' ? NOT_ALLOWED : MAIL_BUDGET_USE_RESEND,
    };
  }

  // 3) Only now provision + notify (service role, see the module docstring).
  //    ANY undelivered mail is a failure: the row grants no access, so an
  //    invite whose mail never arrived did nothing at all. The row stays —
  //    it is the audit record and the Resend handle.
  const sent = await sendInviteEmail(email, { seedName: false });
  if (!sent.ok) {
    revalidatePath('/app');
    return { ok: false, error: MAIL_FAILED_USE_RESEND };
  }

  revalidatePath('/app');
  return { ok: true, message: 'Invite sent.' };
}

/** Re-send the invite mail for an open row (same helper, bumps last_sent_at). */
export async function resendBetaInviteAction(
  _prev: PlatformActionState,
  formData: FormData
): Promise<PlatformActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = platformInviteIdSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: NOT_ALLOWED };

  const supabase = await createClient();
  // Probe first, exactly like inviting: without this, the throttle RPC's 42501
  // would reach a non-platform-admin as a rate-limit message while invite and
  // revoke answer NOT_ALLOWED — a difference worth nothing to us and something
  // to an attacker.
  if (!(await callerIsPlatformAdmin(supabase))) return { ok: false, error: NOT_ALLOWED };

  // Read through RLS: a non-platform-admin sees no row at all, which is the
  // same outcome as an unknown id — no enumeration signal either way.
  const { data: invite } = await supabase
    .from('platform_invites')
    .select('id, email, revoked_at')
    .eq('id', parsed.data.inviteId)
    .maybeSingle();
  if (!invite || invite.revoked_at) return { ok: false, error: NOT_ALLOWED };

  // Budget after the lookup (an unknown id costs nothing) and before the
  // last_sent_at bump (a rate-limited resend must not claim it sent something).
  const budget = await consumeMailBudget(supabase);
  if (budget !== 'ok') {
    return { ok: false, error: budget === 'denied' ? NOT_ALLOWED : RESEND_RATE_LIMITED };
  }

  // The bump is what the audit log records as "resent"; the guard trigger
  // rejects any attempt to change the identity columns alongside it.
  const { error, count } = await supabase
    .from('platform_invites')
    .update({ last_sent_at: new Date().toISOString() }, { count: 'exact' })
    .eq('id', invite.id)
    .is('revoked_at', null);
  if (error || !count) return { ok: false, error: NOT_ALLOWED };

  const sent = await sendInviteEmail(invite.email, { seedName: false });
  // A resend exists only to send mail, so any undelivered mail is a failure.
  if (!sent.ok) return { ok: false, error: RESEND_MAIL_FAILED };

  revalidatePath('/app');
  return { ok: true, message: 'Invite re-sent.' };
}

/**
 * Revoke an open invite.
 *
 * MINIMAL VARIANT, deliberately (open decision, see the PR): this marks the row
 * only. The auth account provisioned by `inviteUserByEmail` is left alone, so
 * the person can still log in and self-onboard. Deleting an unconfirmed auth
 * account is the alternative and needs Max's call.
 */
export async function revokeBetaInviteAction(
  _prev: PlatformActionState,
  formData: FormData
): Promise<PlatformActionState> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "You're not logged in." };

  const parsed = platformInviteIdSchema.safeParse({ inviteId: formData.get('inviteId') });
  if (!parsed.success) return { ok: false, error: NOT_ALLOWED };

  const supabase = await createClient();
  // Probe first, like the other two: all three actions answer NOT_ALLOWED to a
  // caller without access, and none of them leaks a different shape of failure.
  if (!(await callerIsPlatformAdmin(supabase))) return { ok: false, error: NOT_ALLOWED };

  const { error, count } = await supabase
    .from('platform_invites')
    .update(
      { revoked_at: new Date().toISOString(), revoked_by: user.id },
      { count: 'exact' }
    )
    .eq('id', parsed.data.inviteId)
    .is('revoked_at', null);

  if (error || !count) return { ok: false, error: NOT_ALLOWED };

  revalidatePath('/app');
  return { ok: true, message: 'Invite revoked.' };
}
