'use client';

/**
 * Per-surface analytics switch for signed-in users (plan §4–5). Renders null.
 *
 * In-app product analytics is ON by default and the account setting decides
 * (decision 1): `optedOut` comes from `user_profiles.analytics_opt_out_at`, read
 * server-side. The device's banner decision is deliberately NOT consulted here —
 * DB wins for authenticated users. A visitor who declined the banner on the
 * public site and then logs in is tracked in the app unless they opted out in
 * Profile; the consent screen discloses this and Profile has the switch. The
 * banner decision keeps governing the public pages and the marketing category.
 *
 * Order (plan §4): enable → identify → register → group → `app_opened`, so no
 * event is ever sent anonymously from inside the app. Captures made before this
 * runs (the shell's first `screen_viewed`) wait in the adapter's memory queue.
 *
 * Mounted as a SIBLING of the shell in src/app/app/layout.tsx, never inside
 * app.tsx: it reads no query and nothing re-renders it but the layout.
 */
import { useEffect } from 'react';
import { analytics } from './provider';
import { analyticsConfigured } from './config';
import type { AppSurface } from './events';

/** `app_opened` once per page load, not once per venue switch. */
let appOpenedSent = false;

export function AnalyticsGate({
  userId,
  venueId,
  roles,
  optedOut,
  surface,
}: {
  userId: string;
  venueId: string | null;
  roles: readonly string[];
  optedOut: boolean;
  surface: AppSurface;
}): null {
  // A stable dependency for the roles array (a fresh array every layout render).
  const rolesKey = roles.join(',');
  useEffect(() => {
    if (!analyticsConfigured()) return;
    if (optedOut) {
      analytics.disable();
      return;
    }
    let cancelled = false;
    void analytics
      .enable({ userId, venueId, roles: rolesKey ? rolesKey.split(',') : [], surface })
      .then(() => {
        if (cancelled || appOpenedSent || !analytics.isEnabled()) return;
        appOpenedSent = true;
        analytics.capture({ event: 'app_opened', surface });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, venueId, rolesKey, optedOut, surface]);
  return null;
}
