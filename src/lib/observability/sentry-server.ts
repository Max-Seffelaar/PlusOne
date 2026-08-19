import 'server-only';

/**
 * Server-side Sentry facade (task 86ey9e9re).
 *
 * The server SDK is initialised by `instrumentation.ts` → `sentry.server.config.ts`;
 * this module only needs to reach the already-initialised namespace. The value
 * import is dynamic for the ordinary reason — nothing here should pull the SDK
 * into a module graph eagerly — and that also satisfies the lazy-import guard
 * `tests/unit/sentry-lazy-imports.test.ts`, which scans all of `src/` without
 * distinguishing server modules from client ones.
 *
 * The SDK's TYPES are reached the same way, via `typeof import(…)`, and that
 * choice is a workaround: today `import type … from '@sentry/nextjs'` would
 * ALSO trip that guard, even though its own doc comment promises the opposite.
 * The guard's `VALUE_IMPORT` regex spans the whole file, so its `(?!type\s)`
 * lookahead only ever inspects the FIRST import statement — the `import
 * 'server-only'` above is enough to start a match that then runs on to any
 * later Sentry `from` clause. `typeof import(…)` leaves no `from` clause, so it
 * passes. Fixing the regex (anchoring it per statement) is a separate PR —
 * once that lands, `import type` becomes available here too, but there is no
 * reason to switch: this form is correct either way.
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
