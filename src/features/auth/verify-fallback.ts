// Shared verify-type fallback for first-login (P-01, z8uq9m0tnq).
//
// GoTrue stores a one-time token in a *slot* that depends on how the mail was
// sent: a magic-link/OTP mail fills the recovery/magiclink slot (`type: 'email'`
// on verify), while an invite or a never-confirmed account's confirmation mail
// fills the confirmation slot (`type: 'invite'` / `'signup'`). The code the user
// types looks identical in all three cases, and the mail does not tell them
// which slot it came from — so a single hard-coded verify type turns a valid
// code into a 403 for every invitee who has not confirmed their address yet.
//
// Both entry points (the login form's 6-digit code and the link-based
// /auth/confirm route) therefore try the types in order and stop at the first
// one GoTrue accepts. Pure and transport-agnostic so it is unit-tested directly.

import type { EmailOtpType } from '@supabase/supabase-js';

/**
 * Code-entry order at the login form. `email` first: it is the only slot a
 * confirmed, everyday user ever uses, so the common case still costs exactly
 * one round trip. `signup` before `invite` because a re-invited (already
 * existing, never confirmed) account gets the *confirmation* mail, which is the
 * shape that actually broke in prod.
 */
export const OTP_CODE_VERIFY_TYPES = ['email', 'signup', 'invite'] as const satisfies readonly EmailOtpType[];

/**
 * Link verification tries **one type per token slot**, and there are only two
 * slots that matter (measured on GoTrue v2.195.0, PR #324 security review):
 *
 * - `confirmation_token` — `invite` ≡ `signup`;
 * - `recovery_token` — `magiclink` ≡ `email` ≡ `recovery`.
 *
 * Types inside one slot are interchangeable, so retrying `signup` after
 * `invite` costs a round trip and can never find anything new. The only
 * fallback that can help is the *other* slot, and one per slot caps a click at
 * two verifies. That cap matters: this retry runs server-side, so every attempt
 * leaves one shared Vercel egress IP while GoTrue rate-limits `/verify` per IP
 * — a nazorg batch must not cost four verifies per click.
 *
 * **Slot-level isolation does not exist.** Because `magiclink` and `recovery`
 * are the same slot, a recovery token already verifies as `type=magiclink`
 * today, with or without this fallback — so falling back to `magiclink` grants
 * nothing an attacker could not ask for directly. Password auth (and therefore
 * password recovery) is disabled project-wide (decision #20), so no recovery
 * token is ever minted. **Revisit this the day password recovery is enabled.**
 *
 * `email_change` has its own slot and its own flow: it never falls back, and is
 * never a fallback target. Neither is `recovery` itself.
 */
const LINK_SLOT_FALLBACK = {
  // First-login mail → also try the recovery slot.
  invite: 'magiclink',
  signup: 'magiclink',
  // Magic-link mail → also try the confirmation slot (a never-confirmed
  // account's token lives there).
  magiclink: 'invite',
  email: 'invite',
} as const satisfies Partial<Record<string, EmailOtpType>>;

/**
 * The ordered list of types to try for a link that declared `declaredType`:
 * the declared type first, then at most one type from the other slot.
 */
export function linkVerifyTypes(declaredType: EmailOtpType): EmailOtpType[] {
  const other = (LINK_SLOT_FALLBACK as Record<string, EmailOtpType | undefined>)[declaredType];
  return other ? [declaredType, other] : [declaredType];
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  return {};
}

/**
 * True when a failed verify is the "this token is not in *this* slot" class of
 * error, i.e. the only class where trying another type can possibly help.
 *
 * Anything else stops the loop immediately — in particular a rate limit (429):
 * hammering GoTrue with two more attempts after it asked us to slow down only
 * buys the user a longer lockout. Attempts are also capped by the list length
 * (3), never by user input, so this cannot loop.
 */
export function isVerifyTypeMismatchError(error: unknown): boolean {
  const e = asErrorLike(error);
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = typeof e.code === 'string' ? e.code.toLowerCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  // Never retry through a rate limit.
  if (status === 429 || code.includes('rate_limit') || message.includes('rate limit')) return false;

  if (status === 403 || status === 401 || status === 404) return true;
  return (
    code === 'otp_expired' ||
    message.includes('one-time token not found') ||
    message.includes('token not found') ||
    message.includes('token has expired or is invalid') ||
    message.includes('invalid token')
  );
}

export interface VerifyFallbackOutcome<T> {
  /** The type that succeeded, when one did. */
  type?: EmailOtpType;
  /** The successful attempt's payload. */
  data?: T;
  /**
   * The error to surface when every attempt failed. Normally the FIRST
   * attempt's error — the one for the type the user's mail actually claimed,
   * since the later mismatch errors are noise. But a *terminal* error (a rate
   * limit, anything not a slot miss) wins: burying a 429 under an earlier 403
   * shows "that code didn't work" and never starts the cooldown (PR #324
   * security review, S2).
   */
  error?: unknown;
  /** Types actually attempted, in order (asserted by the unit tests). */
  tried: EmailOtpType[];
}

/**
 * Runs `attempt` over `types` in order, stopping at the first success — a valid
 * type is never retried, and the types after a success are never attempted.
 */
export async function verifyWithFallback<T>(
  types: readonly EmailOtpType[],
  attempt: (type: EmailOtpType) => Promise<{ data?: T; error: unknown }>
): Promise<VerifyFallbackOutcome<T>> {
  const tried: EmailOtpType[] = [];
  let firstError: unknown = null;

  for (const type of types) {
    if (tried.includes(type)) continue;
    tried.push(type);
    const { data, error } = await attempt(type);
    if (!error) return { type, data, tried };
    if (firstError === null) firstError = error;
    // A terminal error stops the walk AND is what the user hears about.
    if (!isVerifyTypeMismatchError(error)) return { error, tried };
  }

  return { error: firstError, tried };
}
