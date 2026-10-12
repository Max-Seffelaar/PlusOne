'use client';

/**
 * Root-level consent + anonymous boot for the public pages (plan §3–4,
 * "AnalyticsBoot" + the banner mount). Mounted once in src/app/layout.tsx.
 *
 *  - On a banner route (`/`, `/login`, `/e/<slug>`) with no stored decision it
 *    shows the cookie banner, loaded as its own chunk.
 *  - On `/` and `/login`, once the analytics category is granted, it enables
 *    PostHog anonymously (person_profiles: identified_only, so no person is
 *    created until a later identify in the app merges the funnel).
 *  - Anywhere else it does nothing: signed-in surfaces have their own gate, and
 *    guest/bearer pages are never tracked.
 *
 * Never in the native shell: no banner and no public tracking inside the
 * webview (Capacitor checklist; in-app analytics there follows the account
 * setting through AnalyticsGate). Renders nothing during SSR and hydration —
 * the decision lives in localStorage — so there is no mismatch and no flash.
 */
import { type JSX, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { isNativeShell } from '@/lib/platform';
import { analyticsConfigured } from './config';
import { hasConsent, onConsentChange, readConsent } from './consent';
import { analytics } from './provider';
import { isBannerRoute, isPublicAnalyticsRoute } from './public-routes';

let landingSent = false;

const CookieBanner = dynamic(() => import('./CookieBanner'), { ssr: false });

export function PublicConsent(): JSX.Element | null {
  const pathname = usePathname();
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    if (isNativeShell()) return;
    setShowBanner(isBannerRoute(pathname) && readConsent() === null);

    const apply = (): void => {
      if (!analyticsConfigured() || !isPublicAnalyticsRoute(pathname)) return;
      if (hasConsent('analytics')) {
        void analytics.enable();
        // The one public event, and only with consent (decision 2). Once per
        // page load; queued until the anonymous enable above has loaded.
        if (pathname === '/' && !landingSent) {
          landingSent = true;
          analytics.capture({ event: 'landing_viewed' });
        }
      }
      else if (analytics.isEnabled()) analytics.disable();
      // Declined: nothing captured on this page may ever leave, not even after
      // a later in-app identify. Not `disable()` while idle — that would also
      // drop the app's first screen view when this tab moves on to /app.
      else analytics.discardPending();
    };
    // Only act on a stored decision: before one exists nothing may load.
    if (readConsent() !== null) apply();
    return onConsentChange(() => {
      setShowBanner(false);
      apply();
    });
  }, [pathname]);

  if (!showBanner) return null;
  return <CookieBanner onDone={() => setShowBanner(false)} />;
}
