'use server';

// Throws an UNEXPECTED error (not a MutationError return) so it bubbles to Next's
// onRequestError → Sentry.captureRequestError, verifying the server-action path.
export async function triggerServerError(): Promise<never> {
  throw new Error('sentry-test: server action error');
}
