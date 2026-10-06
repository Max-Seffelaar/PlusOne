import { asExpectedMutationError } from '@/lib/db-errors';
import { addBreadcrumb, captureException } from './sentry-client';

type CaptureContext = { source: 'query' | 'mutation'; key?: string };

/** Errors that are expected operating conditions — never report. */
function isExpected(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // Offline fetch failures: the door/outbox handles these by design.
  if (typeof navigator !== 'undefined' && !navigator.onLine && isNetworkNoise(error)) return true;
  return false;
}

/** Browser/GoTrue "the request never got an answer" errors, per engine. */
const NETWORK_MESSAGES = /^(Load failed|Failed to fetch|NetworkError when attempting to fetch resource\.?)$/;

function isNetworkNoise(error: unknown): boolean {
  if (error instanceof TypeError) return true; // offline fetch (pre-existing rule)
  if (!(error instanceof Error)) return false;
  return error.name === 'AuthRetryableFetchError' || NETWORK_MESSAGES.test(error.message);
}

/**
 * A Supabase `PostgrestError` is a plain object ({ code, details, hint, message}),
 * not an Error — Sentry titles it "Object captured as exception with keys: …" and
 * groups every one of them together. Details are left out (can echo row values / PII).
 */
function isPostgrestLike(error: unknown): error is { code: string; message: string; hint?: string | null } {
  if (typeof error !== 'object' || error === null || error instanceof Error) return false;
  const e = error as Record<string, unknown>;
  return typeof e.code === 'string' && typeof e.message === 'string' && 'details' in e && 'hint' in e;
}

export function captureUnexpectedError(error: unknown, context: CaptureContext): void {
  if (isExpected(error)) return;

  // Known user-facing failure → trail for the next real error, not an issue.
  const expected = asExpectedMutationError(error);
  if (expected) {
    addBreadcrumb({
      category: 'expected-error',
      level: 'info',
      message: expected.message,
      data: { code: expected.code, capture_source: context.source },
    });
    return;
  }

  const tags: Record<string, string> = { capture_source: context.source };
  // Only the key NAMESPACE (queryKey[0]) — full keys can contain search terms.
  const extra: Record<string, unknown> = context.key ? { key: context.key } : {};
  let reported: unknown = error;

  if (isPostgrestLike(error)) {
    const wrapped = new Error(error.message);
    wrapped.name = 'PostgrestError';
    reported = wrapped;
    tags.db_code = error.code;
    if (error.hint) extra.hint = error.hint;
  } else if (isNetworkNoise(error)) {
    // Online and still failing: worth seeing, but grouped apart from real bugs.
    tags.network = 'true';
  }

  captureException(reported, {
    tags,
    extra: Object.keys(extra).length ? extra : undefined,
  });
}
