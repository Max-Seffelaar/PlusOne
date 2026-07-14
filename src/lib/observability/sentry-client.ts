/**
 * Lazy browser-Sentry facade (#B2, task 86ey9e8z5).
 *
 * Every client module that needs Sentry imports from HERE, never from
 * `@sentry/nextjs` directly (a vitest guard, `tests/unit/sentry-lazy-imports.test.ts`,
 * enforces it). Because this module only `import type`s the SDK, none of its
 * importers pull the ~131 kB gz browser SDK into their First Load bundle. The
 * real SDK is fetched + initialised on demand — on idle (scheduled by
 * `instrumentation-client.ts`) or on the first telemetry call — and cached.
 *
 * All exposed calls are fire-and-forget telemetry: a call before the chunk has
 * loaded simply triggers the load and applies once ready. If the chunk can't be
 * fetched at all (e.g. cold-start offline at the door) the load resolves to
 * `null` and the call is a silent no-op — telemetry must NEVER throw into the
 * door's offline path (#25).
 */
import type * as SentryNS from '@sentry/nextjs';

type SentryModule = typeof SentryNS;

let cached: SentryModule | null = null;
let loading: Promise<SentryModule | null> | null = null;

/**
 * Load `@sentry/nextjs` and run `Sentry.init` (the side effect of importing the
 * init module), once. Resolves to the namespace, or `null` if the chunk cannot
 * be fetched — callers never throw. A failed load is retryable (e.g. once the
 * door comes back online).
 */
export function loadSentry(): Promise<SentryModule | null> {
  if (cached) return Promise.resolve(cached);
  loading ??= import('@/sentry.client.init')
    .then((mod) => {
      cached = mod.Sentry;
      return cached;
    })
    .catch(() => {
      loading = null; // allow a later retry
      return null;
    });
  return loading;
}

export function captureException(
  ...args: Parameters<SentryModule['captureException']>
): void {
  void loadSentry().then((s) => s?.captureException(...args));
}

export function captureMessage(
  ...args: Parameters<SentryModule['captureMessage']>
): void {
  void loadSentry().then((s) => s?.captureMessage(...args));
}

export function setUser(...args: Parameters<SentryModule['setUser']>): void {
  void loadSentry().then((s) => s?.setUser(...args));
}

export function setTag(...args: Parameters<SentryModule['setTag']>): void {
  void loadSentry().then((s) => s?.setTag(...args));
}

export function addBreadcrumb(
  ...args: Parameters<SentryModule['addBreadcrumb']>
): void {
  void loadSentry().then((s) => s?.addBreadcrumb(...args));
}

/**
 * Router-transition hook re-exported by `instrumentation-client.ts` for Next's
 * App Router instrumentation. Forwards to the real handler once Sentry is
 * loaded; before that it just nudges the load and drops the (untraced) early
 * transition — negligible at `tracesSampleRate` 0.05.
 */
export const onRouterTransitionStart: SentryModule['captureRouterTransitionStart'] = (
  ...args
) => {
  if (cached) {
    cached.captureRouterTransitionStart(...args);
    return;
  }
  void loadSentry();
};
