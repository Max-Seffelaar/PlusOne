'use client';

import { useEffect, useState } from 'react';

// Source of truth for the desktop↔mobile viewport switch (S0 nav-shell). Below
// 1024px → the mobile app-form (bottom tabs); at/above → the desktop sidebar.
// Matches the breakpoint in `src/lib/ua.ts` and the S0 design (resp-app.jsx uses
// `matchMedia('(max-width:1023px)')`).
//
// Seed with the server's UA hint (isMobileUA) so the first paint matches, then
// let matchMedia take over — it is the real breakpoint and corrects iPad/desktop
// misclassification on the client. Capacitor-safe: matchMedia works in a webview.
const MOBILE_QUERY = '(max-width: 1023px)';

export function useViewport(serverHint = false): boolean {
  const [isMobile, setIsMobile] = useState(serverHint);

  useEffect(() => {
    // Guarded for SSR and webviews without matchMedia (#37, same guard as
    // `hasFinePointer`/`useIsDesktop`) — never throw, just keep the server hint.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setIsMobile(mql.matches);
    update();
    // window resize as a fallback (T14 / retest 3/7): emulated viewports
    // (DevTools device mode) and some webviews reflow WITHOUT firing the
    // media-query change event — a device-mode reload could even measure the
    // pre-emulation desktop width and then stay stuck in the wrong shell.
    // The resize event does fire in those cases, so listen to both.
    //
    // Deliberately NOT debounced (86ey9e9vc review, reverted from an earlier
    // version of this PR): `update` calls `setIsMobile(mql.matches)`, and
    // React's eager-state bailout already drops that setState without
    // scheduling work when the boolean doesn't change — non-crossing resize
    // frames are free. On an actual crossing frame the (necessarily
    // un-debounced) `change` listener below fires in the same task per the
    // HTML "update the rendering" steps, so a debounce on `resize` alone saves
    // zero renders while adding latency on the Capacitor/DevTools-device-mode
    // path where `resize` is the ONLY signal (no `change` event fires there at
    // all) — `isMobile` gates the desktop cockpit vs. the outbox-backed
    // `DoorProvider` (app.tsx) and `DoorRoute.tsx`'s hard
    // `window.location.replace`, so lagging it during a continuous reflow is a
    // real regression, not a neutral one.
    window.addEventListener('resize', update);
    mql.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mql.removeEventListener('change', update);
    };
  }, []);

  return isMobile;
}
