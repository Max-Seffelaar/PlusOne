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
const MOBILE_BREAKPOINT_PX = 1023;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

export function useViewport(serverHint = false): boolean {
  const [isMobile, setIsMobile] = useState(serverHint);

  useEffect(() => {
    // `matchMedia` itself can be absent in a webview (#37, same guard as
    // `hasFinePointer`/`useIsDesktop`) — fall back to `innerWidth` so
    // `isMobile` still corrects instead of freezing at the UA guess forever.
    // `isMobile` gates the desktop cockpit vs. the outbox-backed `DoorProvider`
    // (app.tsx) and `DoorRoute.tsx`'s hard `window.location.replace`, so an
    // uncorrected iPadOS device reporting `Macintosh` (src/lib/ua.ts) would
    // stay stuck off the offline-capable `/door/<id>` route.
    const hasMatchMedia = typeof window.matchMedia === 'function';
    const mql = hasMatchMedia ? window.matchMedia(MOBILE_QUERY) : null;
    const update = (): void => setIsMobile(mql ? mql.matches : window.innerWidth <= MOBILE_BREAKPOINT_PX);
    update();
    // window resize as a fallback (T14 / retest 3/7): emulated viewports
    // (DevTools device mode) and some webviews reflow WITHOUT firing the
    // media-query change event — a device-mode reload could even measure the
    // pre-emulation desktop width and then stay stuck in the wrong shell.
    // The resize event does fire in those cases, so listen to both; when
    // `mql` is null it's also the ONLY signal (no `change` event to fall
    // back on at all).
    //
    // Deliberately NOT debounced — it saved zero renders while regressing the
    // Capacitor/DevTools path (86ey9e9vc review; see docs/changelog.md).
    window.addEventListener('resize', update);
    if (!mql) return () => window.removeEventListener('resize', update);
    // Older webviews only have the deprecated addListener/removeListener
    // (same fallback as `datetime-field.tsx`'s `useIsDesktop`, #37).
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update);
      return () => {
        window.removeEventListener('resize', update);
        mql.removeEventListener('change', update);
      };
    }
    mql.addListener(update);
    return () => {
      window.removeEventListener('resize', update);
      mql.removeListener(update);
    };
  }, []);

  return isMobile;
}
