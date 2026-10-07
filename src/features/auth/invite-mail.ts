import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { requiredServerEnv } from '@/lib/env';
import type { Database } from '@/lib/database.types';
import { teamMailActive } from '@/features/mail/config';
import { sendTeamMail } from '@/features/mail/send';
import { recordAuthInviteMail } from '@/features/mail/limits';
import type { TeamMailContent } from '@/features/mail/templates';

// Shared invite/resend e-mail plumbing for the server actions (invite-actions +
// events/actions). Server-side only — it reaches the service client, which is
// itself a `server-only` module, so any client-bundle import fails the build.

/** GoTrue's many spellings of "this address already has an account". */
export function alreadyRegistered(error: {
  code?: string;
  status?: number;
  message?: string;
}): boolean {
  return (
    error.code === 'email_exists' ||
    error.status === 422 ||
    Boolean(error.message && /already|exists|registered/i.test(error.message))
  );
}

// Bare anon client (no session cookies) used only to send a login-link e-mail
// to an already-registered invitee — never touches the caller's own session.
function createAnonClient() {
  return createSupabaseClient<Database>(
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredServerEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export interface SendInviteEmailOptions {
  /**
   * Seed `raw_user_meta_data.full_name` with the address' local part on the
   * provisioning call. Defaults to true (venue/crew invites, unchanged).
   * Pass false when the address is not necessarily a fresh account of ours —
   * the payload would overwrite an existing unconfirmed user's metadata.
   */
  seedName?: boolean;
  /**
   * Team/crew context for an already-CONFIRMED account (Mail-infra F0): with
   * it, that account gets the PlusOne team mail ("X invited you to join Y")
   * through Resend instead of a bare magic-link login. Without it (platform
   * invites) the magic-link path is exactly as before. Only display data: it
   * is rendered into the mail and never read as authorization.
   */
  existingAccountMail?: TeamMailContent;
  /**
   * The company this invitation mail counts against (daily cap, decision Max
   * 2026-10-07). Set by team/crew invites and resends; when Supabase sends its
   * own invite mail (new or unconfirmed account) the mail is recorded for this
   * company. Platform invites leave it unset and count nowhere.
   */
  mailCapVenueId?: string;
}

export type InviteMailResult =
  /** Mail sent (invite mail or magic-link fallback). */
  | { ok: true }
  /** The address could not be provisioned/invited at all — always an error. */
  | { ok: false; reason: 'provision' }
  /** The account exists; only the notify mail failed. An initial invite may
   *  proceed anyway (access comes from the invite row, not the mail); a RESEND
   *  must surface this, because the mail is the whole point. */
  | { ok: false; reason: 'notify' };

/**
 * Notify an invitee by e-mail (invite + every resend, venue AND crew). For a
 * NEW or invited-but-never-accepted address, inviteUserByEmail provisions/
 * re-invites and sends the "You've been invited" mail in one step; an already-
 * CONFIRMED address gets either the team mail (when the caller passes
 * `existingAccountMail` and team mail is active, see `teamMailActive`) or, as
 * before, a magic-link login (invite-only — no public signups, #20). The
 * confirmed path matters: signInWithOtp refuses unconfirmed accounts outright
 * ("Signups not allowed for this instance"), so the order is invite-first —
 * that's what makes resend work for never-accepted accounts.
 */
export async function sendInviteEmail(
  email: string,
  options: SendInviteEmailOptions = {}
): Promise<InviteMailResult> {
  const service = createServiceClient();
  // `data` OVERWRITES raw_user_meta_data on an existing but unconfirmed account,
  // so it is opt-in (security review 2026-09-23, F5). Venue/crew invites keep
  // seeding a placeholder name because `accept_pending_invites()` reads
  // `raw_user_meta_data ->> 'full_name'`; platform invites, which can target an
  // arbitrary address, pass `seedName: false` and write nothing.
  const { error: inviteMailError } = await service.auth.admin.inviteUserByEmail(
    email,
    options.seedName === false ? undefined : { data: { full_name: email.split('@')[0] } }
  );
  if (inviteMailError && alreadyRegistered(inviteMailError)) {
    if (options.existingAccountMail && teamMailActive()) {
      // Best effort by contract: sendTeamMail never throws. A failed send is a
      // 'notify' failure, the same contract as a failed magic link below.
      const sent = await sendTeamMail({ ...options.existingAccountMail, to: email });
      return sent.ok ? { ok: true } : { ok: false, reason: 'notify' };
    }
    const mailer = createAnonClient();
    const { error: otpError } = await mailer.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpError) {
      console.error('sendInviteEmail: existing-user notify failed', otpError.message);
      return { ok: false, reason: 'notify' };
    }
  } else if (inviteMailError) {
    console.error('sendInviteEmail: inviteUserByEmail failed', inviteMailError.message);
    return { ok: false, reason: 'provision' };
  } else if (options.mailCapVenueId) {
    // Supabase just sent its invite mail over the shared Resend account.
    await recordAuthInviteMail(options.mailCapVenueId, email);
  }
  return { ok: true };
}
