import { captureException } from './sentry-client';

/** Errors that are expected operating conditions — never report. */
function isExpected(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  // Offline fetch failures: the door/outbox handles these by design.
  if (
    typeof navigator !== 'undefined' &&
    !navigator.onLine &&
    error instanceof TypeError
  ) {
    return true;
  }
  return false;
}

export function captureUnexpectedError(
  error: unknown,
  context: { source: 'query' | 'mutation'; key?: string },
): void {
  if (isExpected(error)) return;
  captureException(error, {
    tags: { capture_source: context.source },
    // Only the key NAMESPACE (queryKey[0]) — full keys can contain search terms.
    extra: context.key ? { key: context.key } : undefined,
  });
}
