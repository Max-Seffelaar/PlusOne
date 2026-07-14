/**
 * Client instrumentation entry (Next.js loads this on every route). It used to
 * `Sentry.init` synchronously, which pinned the ~131 kB gz browser SDK into the
 * First Load JS shared by ALL routes — the door PWA and the public guest links
 * included (task 86ey9e8z5, #B2).
 *
 * Now it only SCHEDULES the SDK: the real init runs from the lazy facade
 * (`@/lib/observability/sentry-client`) once the page is idle, so first paint
 * and interactivity never wait on Sentry. This is a pure defer — no route loses
 * error coverage; the only loss is errors thrown in the brief idle window before
 * init. The offline transport still queues envelopes once loaded.
 */
import {
  loadSentry,
  onRouterTransitionStart as deferredOnRouterTransitionStart,
} from '@/lib/observability/sentry-client';

if (typeof window !== 'undefined') {
  const w = window as typeof window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(() => void loadSentry(), { timeout: 3000 });
  } else {
    window.setTimeout(() => void loadSentry(), 2000);
  }
}

// Re-exported for Next's App Router transition instrumentation.
export const onRouterTransitionStart = deferredOnRouterTransitionStart;
