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
    const mql = window.matchMedia(MOBILE_QUERY);
    const update = (): void => setIsMobile(mql.matches);
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  return isMobile;
}
