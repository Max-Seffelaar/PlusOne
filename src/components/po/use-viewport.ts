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

// A window resize fires dozens of times per second while a user drags the
// browser edge (or on some webview reflows) — each one called setIsMobile
// synchronously (86ey9e9vc, #45). React 18 already bails out of re-rendering
// when the value doesn't cross the breakpoint, but every crossing frame during
// a continuous drag still forced a render; debouncing collapses a whole drag
// gesture into one settle instead of one per frame. The `change` listener on
// the media query itself already only fires on an actual crossing, so it's
// left un-debounced — instant is correct there.
const RESIZE_DEBOUNCE_MS = 120;

export function useViewport(serverHint = false): boolean {
  const [isMobile, setIsMobile] = useState(serverHint);

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setIsMobile(mql.matches);
    update();
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdate = (): void => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(update, RESIZE_DEBOUNCE_MS);
    };
    // window resize as a fallback (T14 / retest 3/7): emulated viewports
    // (DevTools device mode) and some webviews reflow WITHOUT firing the
    // media-query change event — a device-mode reload could even measure the
    // pre-emulation desktop width and then stay stuck in the wrong shell.
    // The resize event does fire in those cases, so listen to both.
    window.addEventListener('resize', debouncedUpdate);
    mql.addEventListener('change', update);
    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      window.removeEventListener('resize', debouncedUpdate);
      mql.removeEventListener('change', update);
    };
  }, []);

  return isMobile;
}
