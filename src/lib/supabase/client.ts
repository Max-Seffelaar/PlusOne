import { createBrowserClient } from '@supabase/ssr';
import type { Database } from '../database.types';
import { AUTH_COOKIE_MAX_AGE } from './cookie-options';

/**
 * Realtime client-side throttle (supabase-js `RealtimeClientOptions.params`).
 *
 * supabase-js defaults to `eventsPerSecond: 10`. The door/cockpit subscribe to
 * `check_ins` INSERTs; during a busy door a venue easily exceeds 10 check-ins/sec
 * and the default SILENTLY drops every realtime event above the cap until the next
 * refetch. A clean burst test (#0b: 500 check-ins @ ~596/sec, 2 subscribers)
 * measured 0/500 received at the default 10, and 500/500 (lag p50 161ms / p95
 * 219ms) at 200 — so 200 is the proven 0%-drop value for our door bursts. Both
 * browser clients (the generic `createClient` and the door's `getDoorClient`)
 * MUST pass this. The real scale fix (Broadcast instead of postgres_changes) is a
 * separate track (#3) and out of scope here.
 */
export const REALTIME_EVENTS_PER_SECOND = 200;

export const createClient = () => {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Persist the session across browser restarts (ClickUp "30 dagen onthouden").
      cookieOptions: { maxAge: AUTH_COOKIE_MAX_AGE },
      // Raise the realtime throttle so door/cockpit bursts are not dropped (#0b).
      realtime: { params: { eventsPerSecond: REALTIME_EVENTS_PER_SECOND } },
    }
  );
};
