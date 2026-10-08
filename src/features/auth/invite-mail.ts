import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';
import { requiredServerEnv } from '@/lib/env';
import type { Database } from '@/lib/database.types';
import { teamMailActive } from '@/features/mail/config';
import { sendTeamMail, type TeamMailCta } from '@/features/mail/send';
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
   * Team/crew context (Mail-infra F0; one invite mail, z8uq9m2yvp): with it
   * and team mail active, EVERY address gets the PlusOne mail ("X invited you
   * to join Y") through Resend: a new or never-confirmed one with a one-time
   * sign-in button, a confirmed one with the /login button. Without it
   * (platform invites) the Supabase path is exactly as before. Only display
   * data: it is rendered into the mail and never read as authorization.
   */
  existingAccountMail?: TeamMailContent;
  /**
   * The company this invitation mail counts against (daily cap, decision Max
   * 2026-10-07). Set by team/crew invites and resends. Our own mail counts
   * through its mail_log row (content.venueId); this is only read when
   * Supabase sends its invite mail (prod without a Resend key), which is then
   * recorded for this company. Platform invites leave it unset.
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
  | { ok: false; reason: 'notify' }
  /** A mail already went to this address within the last minute (our
   *  per-recipient window, or GoTrue's own resend limit). Nothing was sent. */
  | { ok: false; reason: 'recent' }
  /** The company's daily invitation-mail cap, hit at send time. */
  | { ok: false; reason: 'cap' };

/** GoTrue's per-ADDRESS resend limit ("For security purposes, you can only
 *  request this after N seconds"). GoTrue answers its project-wide hourly mail
 *  cap with the same 429 / over_email_send_rate_limit, and that one is a real
 *  failure (no mail went to anyone): only the per-address text is `recent`. */
function rateLimited(error: { message?: string }): boolean {
  return /you can only request this after/i.test(error.message ?? '');
}

/**
 * One invite mail (z8uq9m2yvp): a team or crew invite (the caller passes
 * `existingAccountMail`) with team mail active sends OUR mail to every address.
 * The send is logged first (recipient window + company cap in
 * log_mail_attempt); only then does generateLink provision a new address, or
 * mint a fresh sign-in token for a never-confirmed one, and that link becomes
 * the mail's button. GoTrue sends nothing on this path. An address that can
 * already log in (generateLink: already registered) gets the same mail with
 * the plain /login button. The link is a bearer credential: it goes into the
 * rendered mail and nowhere else, and errors here log codes, never messages.
 */
async function sendOwnInviteMail(
  email: string,
  content: TeamMailContent,
  seedName: boolean
): Promise<InviteMailResult> {
  const cta = async (): Promise<TeamMailCta> => {
    try {
      const { data, error } = await createServiceClient().auth.admin.generateLink({
        type: 'invite',
        email,
        options: seedName ? { data: { full_name: email.split('@')[0] } } : undefined,
      });
      if (error && alreadyRegistered(error)) return { kind: 'login' };
      const props = data?.properties;
      const verifyType = props?.verification_type;
      if (error || !props?.hashed_token || (verifyType !== 'invite' && verifyType !== 'signup')) {
        console.error('sendInviteEmail: generateLink failed', { code: error?.code, status: error?.status });
        return { kind: 'unavailable' };
      }
      return { kind: 'invite', link: { tokenHash: props.hashed_token, verifyType } };
    } catch (err) {
      console.error('sendInviteEmail: generateLink threw', { error: err instanceof Error ? err.name : 'unknown' });
      return { kind: 'unavailable' };
    }
  };
  // Best effort by contract: sendTeamMail never throws.
  const sent = await sendTeamMail({ ...content, to: email }, { cta });
  if (sent.ok) return { ok: true };
  if (sent.reason === 'recipient_window') return { ok: false, reason: 'recent' };
  if (sent.reason === 'venue_cap') return { ok: false, reason: 'cap' };
  if (sent.reason === 'cta_unavailable') return { ok: false, reason: 'provision' };
  return { ok: false, reason: 'notify' };
}

/**
 * Notify an invitee by e-mail (invite + every resend, venue AND crew). Team and
 * crew invites with team mail active go through `sendOwnInviteMail` above: one
 * PlusOne mail whether or not the address has an account. Otherwise (platform
 * invites, or prod without a Resend key, see `teamMailActive`) the Supabase
 * path is exactly as before: for a NEW or invited-but-never-accepted address,
 * inviteUserByEmail provisions/re-invites and sends the "You've been invited"
 * mail in one step; an already-CONFIRMED address gets a magic-link login
 * (invite-only, no public signups, #20). The confirmed path matters:
 * signInWithOtp refuses unconfirmed accounts outright ("Signups not allowed for
 * this instance"), so the order is invite-first, which is what makes resend
 * work for never-accepted accounts.
 */
export async function sendInviteEmail(
  email: string,
  options: SendInviteEmailOptions = {}
): Promise<InviteMailResult> {
  if (options.existingAccountMail && teamMailActive()) {
    return sendOwnInviteMail(email, options.existingAccountMail, options.seedName !== false);
  }
  const service = createServiceClient();
  // `data` OVERWRITES raw_user_meta_data on an existing but unconfirmed account,
  // so it is opt-in (security review 2026-09-23, F5). Venue/crew invites keep
  // seeding a placeholder name because `ensure_my_profile()` reads
  // `raw_user_meta_data ->> 'full_name'`; platform invites, which can target an
  // arbitrary address, pass `seedName: false` and write nothing.
  const { error: inviteMailError } = await service.auth.admin.inviteUserByEmail(
    email,
    options.seedName === false ? undefined : { data: { full_name: email.split('@')[0] } }
  );
  if (inviteMailError && alreadyRegistered(inviteMailError)) {
    const mailer = createAnonClient();
    const { error: otpError } = await mailer.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });
    if (otpError && rateLimited(otpError)) return { ok: false, reason: 'recent' };
    if (otpError) {
      console.error('sendInviteEmail: existing-user notify failed', otpError.message);
      return { ok: false, reason: 'notify' };
    }
  } else if (inviteMailError && rateLimited(inviteMailError)) {
    return { ok: false, reason: 'recent' };
  } else if (inviteMailError) {
    console.error('sendInviteEmail: inviteUserByEmail failed', inviteMailError.message);
    return { ok: false, reason: 'provision' };
  } else if (options.mailCapVenueId) {
    // Supabase just sent its invite mail over the shared Resend account.
    await recordAuthInviteMail(options.mailCapVenueId, email);
  }
  return { ok: true };
}
