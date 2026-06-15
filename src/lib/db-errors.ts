/**
 * Maps database errors to safe Dutch UI copy. The quota engine raises custom
 * SQLSTATEs (see 20260613180000_quota_engine.sql); their messages are
 * deliberately user-facing and PII-free, so we surface them. Everything else
 * collapses to a generic message — details stay in the server logs only
 * (CLAUDE.md security checklist: "Errors returned to the client are generic").
 */

export interface MutationError {
  ok: false;
  /** Stable code the UI can branch on (the SQLSTATE, or 'unauthorized'/'invalid'). */
  code: string;
  /** Dutch, safe to show. */
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
      // These DB messages are crafted Dutch UI copy with safe numbers only.
      return { ok: false, code, message: error?.message ?? 'Niet toegestaan.' };
    case INSUFFICIENT_PRIVILEGE:
      return {
        ok: false,
        code,
        message: 'Je hebt hier geen rechten voor (of MFA is vereist).',
      };
    case UNIQUE_VIOLATION:
      return { ok: false, code, message: 'Dit bestaat al.' };
    case NOT_NULL_VIOLATION:
    case CHECK_VIOLATION:
      return { ok: false, code, message: 'Sommige gegevens ontbreken of zijn ongeldig.' };
    default:
      return { ok: false, code, message: 'Er ging iets mis. Probeer het opnieuw.' };
  }
}

export const unauthorized = (): MutationError => ({
  ok: false,
  code: 'unauthorized',
  message: 'Je sessie is verlopen. Log opnieuw in.',
});

export const invalidInput = (message = 'Controleer de ingevulde gegevens.'): MutationError => ({
  ok: false,
  code: 'invalid',
  message,
});
