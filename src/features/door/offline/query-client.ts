/**
 * QueryClient tuned for the door: long-lived cache so a snapshot survives days
 * of persistence, `offlineFirst` so queries serve cached data and mutations are
 * attempted even when the browser thinks it is offline (we manage retries via
 * the outbox, not React Query). Window-focus refetch is off — we run our own
 * delta-sync in useDoorSync (spec §4 point 2).
 */
import { QueryClient } from '@tanstack/react-query';

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export function createDoorQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        gcTime: WEEK_MS,
        staleTime: 1000 * 30,
        networkMode: 'offlineFirst',
        retry: 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: {
        networkMode: 'offlineFirst',
      },
    },
  });
}

let sharedDoorClient: QueryClient | null = null;

/**
 * Per-browser-tab-session singleton door client (86ey9e8pm / L1). The door client
 * MUST NOT be rebuilt per mount: on /app the Deur-tab mounts DoorQueryProvider
 * INSIDE PlusOneApp, which remounts fully on every `router.push` navigation
 * (app.tsx:244-257). A fresh client per mount left its `gcTime: WEEK_MS` gc timers
 * pinning the whole event snapshot (150-1500+ rows) for a week — one leaked client
 * per Deur-tab visit, so the heap grew over a shift ("trager over tijd"). Reusing
 * one client also serves a warm cache on re-entry: no IndexedDB re-restore, no
 * snapshot refetch. Resets only on a full page load — sign-out does
 * `window.location.assign` (settings/_shared.tsx) which wipes the in-memory cache,
 * so PII posture is unchanged. This is the same one-client-per-session model the
 * standalone /door route already uses (its provider lives in the route layout).
 */
export function getDoorQueryClient(): QueryClient {
  return (sharedDoorClient ??= createDoorQueryClient());
}
