'use client';

/**
 * The analytics gate for the standalone door route (`/door/<eventId>`).
 *
 * That route's layout is static on purpose: `/door/<eventId>` HTML sits in the
 * service worker's PERSISTENT shell cache, which must stay PII-free
 * (public/service-worker.js, tests/unit/service-worker-cache-scope.test.ts). So
 * the user id and the opt-out cannot be server-rendered into it the way the
 * `/app` layout does. Instead this resolves both on the client, after mount:
 * the user from the local session (no network), the opt-out through
 * `my_profile()`. Offline, or on any error, it stays off (fail closed: an
 * unknown opt-out is treated as opted out). Without a PostHog key it does
 * nothing at all — not even the session read.
 *
 * The Deur tab inside `/app` is covered by the `/app` gate, not by this one.
 */
import { type JSX, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { analyticsConfigured } from './config';
import { AnalyticsGate } from './AnalyticsGate';
import { analytics } from './provider';

export function DoorAnalyticsGate(): JSX.Element | null {
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    if (!analyticsConfigured()) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: s } = await supabase.auth.getSession();
        const uid = s.session?.user.id;
        if (!uid) return analytics.disable();
        const { data, error } = await supabase
          .rpc('my_profile')
          .select('analytics_opt_out_at')
          .eq('id', uid)
          .maybeSingle();
        if (cancelled) return;
        if (error || !data || data.analytics_opt_out_at !== null) return analytics.disable();
        setUserId(uid);
      } catch {
        if (!cancelled) analytics.disable();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  if (!userId) return null;
  return <AnalyticsGate userId={userId} venueId={null} roles={[]} optedOut={false} surface="door" />;
}
