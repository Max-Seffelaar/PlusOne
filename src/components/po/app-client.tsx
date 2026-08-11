'use client';

/**
 * Client-only mount for `PlusOneApp` (86eya4yuf) — `/app` must NOT render the
 * shell through a server-streamed Suspense boundary.
 *
 * Why: `PlusOneApp` reads `useSearchParams()`, which suspends during SSR, so
 * rendering it directly under the page's `<Suspense>` streams the entire app
 * as a late `$RC()`-completed boundary. Next 15.5's inline fizz runtime gates
 * both that reveal ($RV) and React's hydration retry (`_reactRetry`) on
 * `requestAnimationFrame` with no timeout fallback while `$RT` is unset — and
 * a tab that has never painted (opened in the background, headless webview)
 * never fires rAF. The boundary then never reveals or never hydrates: zero
 * queries mount, zero fetches fire, and Home/Deur sit forever on SSR HTML
 * whose zero-filled counts look like a settled "no events" state.
 *
 * `ssr: false` removes the server suspension by construction: the server only
 * renders the boot placeholder below (a complete inline boundary — those
 * hydrate on the normal, non-rAF-gated path), and the shell mounts entirely
 * client-side. Nothing of value is lost: every /app read is client-side React
 * Query anyway, so the old SSR output was misleading zero placeholders.
 */
import type { JSX } from 'react';
import dynamic from 'next/dynamic';

/** Honest boot state: brand mark on the app background, no fake-zero data. */
function AppBootScreen(): JSX.Element {
  return (
    <div className="flex h-[100dvh] items-center justify-center bg-bg">
      <div className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-acc font-display text-[16px] font-extrabold text-on-acc motion-safe:animate-pulse">
        +1
      </div>
    </div>
  );
}

const PlusOneAppLazy = dynamic(() => import('./app').then((m) => m.PlusOneApp), {
  ssr: false,
  loading: () => <AppBootScreen />,
});

export function PlusOneAppClient(): JSX.Element {
  return <PlusOneAppLazy />;
}
