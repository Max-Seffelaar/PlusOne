'use server';

// Throws an UNEXPECTED error (not a MutationError return) so it bubbles to Next's
// onRequestError → Sentry.captureRequestError, verifying the server-action path.
// The action id survives into the prod bundle even though the page 404s there, so
// guard it: a crafted POST in prod would otherwise generate noise-errors in Sentry.
export async function triggerServerError(): Promise<void> {
  if (process.env.VERCEL_ENV === 'production') return;
  throw new Error('sentry-test: server action error');
}
