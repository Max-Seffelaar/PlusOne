import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { requiredServerEnv } from '@/lib/env';
import type { Database } from '@/lib/database.types';

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
 * CONFIRMED address gets a magic-link login instead (invite-only — no public
 * signups, #20). The confirmed path matters: signInWithOtp refuses unconfirmed
 * accounts outright ("Signups not allowed for this instance"), so the order is
 * invite-first — that's what makes resend work for never-accepted accounts.
 */
export async function sendInviteEmail(email: string): Promise<InviteMailResult> {
  const service = createServiceClient();
  const { error: inviteMailError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: email.split('@')[0] },
  });
  if (inviteMailError && alreadyRegistered(inviteMailError)) {
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
  }
  return { ok: true };
}
