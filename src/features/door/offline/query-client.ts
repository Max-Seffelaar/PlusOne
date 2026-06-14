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
