// Maps Supabase auth/RLS errors to short, generic copy (CLAUDE.md:
// "Errors returned to the client are generic; details go to server logs only"
// and "never reveal whether a guest/e-mail already exists"). Pure function so
// it is unit-tested directly.

export interface NormalizedAuthError {
  message: string;
  /** Seconds the user must wait before retrying, when the error is a rate limit. */
  retryAfterSeconds?: number;
}

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
}

const GENERIC = 'Something went wrong. Try again.';

/** Extracts the wait time from GoTrue's "...after N seconds" rate-limit text. */
export function parseRetryAfterSeconds(message: string): number | undefined {
  const m = message.match(/after (\d+) second/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function asErrorLike(error: unknown): ErrorLike {
  if (error && typeof error === 'object') return error as ErrorLike;
  return {};
}

export function describeAuthError(error: unknown): NormalizedAuthError {
  const e = asErrorLike(error);
  const code = typeof e.code === 'string' ? e.code : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  const message = typeof e.message === 'string' ? e.message : '';
  const lower = message.toLowerCase();

  // Rate limiting (anti-abuse + anti-enumeration, spec §5).
  if (
    status === 429 ||
    code.includes('rate_limit') ||
    lower.includes('rate limit') ||
    lower.includes('you can only request this after')
  ) {
    const retryAfterSeconds = parseRetryAfterSeconds(message);
    return {
      message: retryAfterSeconds
        ? `Too many tries. Try again in ${retryAfterSeconds} seconds.`
        : 'Too many tries. Wait a moment and try again.',
      retryAfterSeconds,
    };
  }

  // Wrong / expired OTP or magic-link token.
  if (
    code === 'otp_expired' ||
    code === 'otp_disabled' ||
    lower.includes('token has expired') ||
    lower.includes('invalid') && (lower.includes('otp') || lower.includes('token') || lower.includes('code'))
  ) {
    return { message: "That code didn't work or has expired. Request a new one." };
  }

  // MFA / TOTP verification failure.
  if (code === 'mfa_verification_failed' || lower.includes('totp') || lower.includes('mfa')) {
    return { message: "That verification code isn't right. Try again." };
  }

  // Signups disabled (invite-only) — do not reveal whether the e-mail exists.
  if (code === 'signup_disabled' || lower.includes('signups not allowed')) {
    return { message: "This account doesn't exist or isn't invited. Ask an admin for an invite." };
  }

  // RLS / privilege denial bubbling up from Postgres (defense-in-depth surface).
  if (code === '42501' || lower.includes('row-level security') || lower.includes('not authorized')) {
    return { message: "You don't have access to this action." };
  }

  return { message: GENERIC };
}
