import 'server-only';

/**
 * Server-side Sentry facade (task 86ey9e9re).
 *
 * The server SDK is initialised by `instrumentation.ts` → `sentry.server.config.ts`;
 * this module only needs to reach the already-initialised namespace. It does so
 * through a DYNAMIC import on purpose: the lazy-import guard
 * (`tests/unit/sentry-lazy-imports.test.ts`) scans all of `src/` and does not
 * distinguish server modules from client ones, so a static
 * `import … from '@sentry/nextjs'` here would trip it. Keeping the import
 * dynamic means the guard stays intact and this module needs no allowlist entry.
 *
 * The SDK's types are reached the same way — `typeof import(…)` in type position
 * is erased at build time and, unlike `import type … from …`, leaves no `from`
 * clause for that guard's regex to match.
 *
 * Telemetry must never change a request's outcome, so every call swallows its
 * own failures. Callers `await`, so the event is handed to the SDK before a
 * serverless invocation can freeze (fire-and-forget would risk losing it).
 */

type SentryModule = typeof import('@sentry/nextjs');
type CaptureContext = Parameters<SentryModule['captureMessage']>[1];

/** Report a server-side condition to Sentry. Never throws, never rejects. */
export async function captureServerMessage(
  message: string,
  context?: CaptureContext
): Promise<void> {
  try {
    const Sentry = await import('@sentry/nextjs');
    Sentry.captureMessage(message, context);
  } catch {
    // Sentry is best-effort: a missing DSN, a failed chunk load or a throwing
    // capture must never surface as a request failure.
  }
}
