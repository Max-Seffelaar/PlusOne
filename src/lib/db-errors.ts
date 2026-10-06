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
const CAPACITY_EXCEEDED = '45005';
const LINK_FULL = '45006';
const INSUFFICIENT_PRIVILEGE = '42501';
const UNIQUE_VIOLATION = '23505';
const NOT_NULL_VIOLATION = '23502';
const CHECK_VIOLATION = '23514';

/** The copy for INSUFFICIENT_PRIVILEGE below — exported so a call site that knows
 *  a specific privilege-gated action failed can offer a more actionable hint than
 *  this generic message, without re-typing (and risking drift from) the string. */
export const INSUFFICIENT_PRIVILEGE_MESSAGE = "You don't have rights for this.";

export function mapMutationError(error: PostgrestLikeError | null | undefined): MutationError {
  const code = error?.code ?? 'unknown';

  switch (code) {
    case QUOTA_EXCEEDED:
    case TIER_FULL:
    case REQUEST_DECIDED:
    case INVALID_TRANSITION:
    case CAPACITY_EXCEEDED:
    case LINK_FULL:
      // These DB messages are crafted UI copy with safe numbers only.
      return { ok: false, code, message: error?.message ?? 'Not allowed.' };
    case INSUFFICIENT_PRIVILEGE:
      // No AAL2/MFA requirement exists anywhere in RLS (decision #20, 2026-07-02)
      // — privilege here is role-only, so the copy never invents an MFA excuse.
      return {
        ok: false,
        code,
        message: INSUFFICIENT_PRIVILEGE_MESSAGE,
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

/** RLS silently filtered the row out of the write (0 rows, no Postgrest error) — not a false success. */
export const notFound = (): MutationError => ({
  ok: false,
  code: 'not_found',
  message: "Couldn't save this change (no access, or it no longer exists).",
});

/** Codes that mean "the user hit a rule we told them about" — never a bug. */
const EXPECTED_CODES = new Set<string>([
  QUOTA_EXCEEDED,
  TIER_FULL,
  REQUEST_DECIDED,
  INVALID_TRANSITION,
  CAPACITY_EXCEEDED,
  LINK_FULL,
  INSUFFICIENT_PRIVILEGE,
  UNIQUE_VIOLATION,
  // 23502/23514 are deliberately NOT expected: input is Zod-validated first, so a
  // NOT NULL/CHECK violation reaching the DB means schema drift — a bug.
  'unauthorized',
  'invalid',
  'invalid_input',
  'exists',
  'already_handled',
  'already_subscribed',
  'not_found',
]);

/**
 * The user-facing copy of the expected failures. `po/mutations.ts` rethrows a
 * server action's MutationError as `new Error(res.message)`, so by the time it
 * reaches React Query's MutationCache the `code` is gone and only the (safe,
 * crafted) message survives — we recognise that copy as the fallback.
 */
const EXPECTED_MESSAGES: readonly (string | RegExp)[] = [
  INSUFFICIENT_PRIVILEGE_MESSAGE,
  'This already exists.',
  'Check the details you entered.',
  'Your session expired. Log in again.',
  /^Couldn't save this change \(no access/,
  'This request has already been handled.',
  /^This email already has an account/,
  /^There already is an active subscription/,
  // billing soft-block (features/billing/gate.ts BLOCK_MESSAGES)
  /^The subscription is canceled\./,
  /^Your trial has ended\./,
  // URL-field validation copy
  /Start it with https:\/\//,
];

export interface ExpectedMutationError {
  code?: string;
  message: string;
}

/**
 * Recognises a *user-facing* failure: a MutationError ({ok:false, code, message})
 * with a known code (or a `billing_*` code), an Error carrying such a `code`, or
 * an Error whose message is known user copy. Returns null for everything else —
 * unknown codes ('unknown', 'invite', 'error', …) stay reportable, they may be bugs.
 */
export function asExpectedMutationError(error: unknown): ExpectedMutationError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code, message, ok } = error as { code?: unknown; message?: unknown; ok?: unknown };
  const text = typeof message === 'string' ? message : '';
  // A raw PostgrestError has code+message but no `ok:false`; a 42501 there is an
  // RLS denial on a read/write the UI should not have attempted — keep reporting it.
  const isMutationShape = ok === false || error instanceof Error;
  if (isMutationShape && typeof code === 'string' && (EXPECTED_CODES.has(code) || code.startsWith('billing_'))) {
    return { code, message: text };
  }
  if (error instanceof Error && EXPECTED_MESSAGES.some((m) => (typeof m === 'string' ? m === text : m.test(text)))) {
    return { message: text };
  }
  return null;
}
