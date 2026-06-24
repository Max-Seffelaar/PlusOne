/**
 * Maps database errors to safe UI copy. The quota engine raises custom
 * SQLSTATEs (see 20260613180000_quota_engine.sql); their messages are
 * deliberately user-facing and PII-free, so we surface them. Everything else
 * collapses to a generic message — details stay in the server logs only
 * (CLAUDE.md security checklist: "Errors returned to the client are generic").
 */

export interface MutationError {
  ok: false;
  /** Stable code the UI can branch on (the SQLSTATE, or 'unauthorized'/'invalid'). */
  code: string;
  /** Safe to show. */
  message: string;
}

interface PostgrestLikeError {
  code?: string;
  message?: string;
}

const QUOTA_EXCEEDED = '45001';
const TIER_FULL = '45002';
const REQUEST_DECIDED = '45003';
const INVALID_TRANSITION = '45004';
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

export function mapMutationError(error: PostgrestLikeError | null | undefined): MutationError {
  const code = error?.code ?? 'unknown';

  switch (code) {
    case QUOTA_EXCEEDED:
    case TIER_FULL:
    case REQUEST_DECIDED:
    case INVALID_TRANSITION:
      // These DB messages are crafted UI copy with safe numbers only.
      return { ok: false, code, message: error?.message ?? 'Not allowed.' };
    case INSUFFICIENT_PRIVILEGE:
      return {
        ok: false,
        code,
        message: "You don't have rights for this (or MFA is required).",
      };
    case UNIQUE_VIOLATION:
      return { ok: false, code, message: 'This already exists.' };
    case NOT_NULL_VIOLATION:
    case CHECK_VIOLATION:
      return { ok: false, code, message: 'Some details are missing or invalid.' };
    default:
      return { ok: false, code, message: 'Something went wrong. Try again.' };
  }
}

export const unauthorized = (): MutationError => ({
  ok: false,
  code: 'unauthorized',
  message: 'Your session expired. Log in again.',
});

export const invalidInput = (message = 'Check the details you entered.'): MutationError => ({
  ok: false,
  code: 'invalid',
  message,
});
