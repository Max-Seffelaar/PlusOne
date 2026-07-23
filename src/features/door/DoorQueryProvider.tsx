'use client';

/**
 * TanStack Query provider with IndexedDB persistence for the door route. The
 * snapshot cache is restored from IndexedDB on boot so the door opens instantly
 * and works offline after a reload (spec §4, decision #25).
 */
import { useState, type ReactNode } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import type { QueryClient } from '@tanstack/react-query';
import { getDoorQueryClient } from './offline/query-client';
import { getDoorPersister } from './offline/persister';
import { isStaleDoorQuery, shouldDehydrateDoorQuery } from './offline/dehydrate';

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

/**
 * Schema version for the persisted door snapshot. BUMP THIS whenever the shape of
 * the cached DoorSnapshot (queries.ts) changes — a mismatched buster makes
 * PersistQueryClient DROP the persisted cache instead of restoring a stale-shaped
 * one that could linger offline for up to a week and crash the door (C14).
 *
 * v2: the snapshot's guest rows are narrowed to the door-rendered columns
 * (P-IDB7) — a v1 blob would restore full-shaped rows, so bump to discard it.
 */
const DOOR_CACHE_BUSTER = 'door-snapshot-v2';

/** Boot sweep: drop stale, unobserved door snapshots that hydration restored so a
 *  low-RAM door phone doesn't hold months of old events in memory (P-IDB1). The
 *  dehydrate gate already keeps them out of the next write; this frees them now. */
function sweepStaleDoorQueries(client: QueryClient): void {
  const now = Date.now();
  const cache = client.getQueryCache();
  for (const query of cache.findAll()) {
    if (isStaleDoorQuery(query, now, WEEK_MS)) cache.remove(query);
  }
}

export function DoorQueryProvider({ children }: { children: ReactNode }): JSX.Element {
  // Session singletons, NOT per-mount factories: on /app this provider mounts
  // inside the remounting PlusOneApp shell (86ey9e8pm) — a fresh client per mount
  // leaked its week-long gc timers. See getDoorQueryClient's doc comment.
  const [client] = useState(getDoorQueryClient);
  const [persister] = useState(getDoorPersister);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: WEEK_MS,
        buster: DOOR_CACHE_BUSTER,
        // Only fresh door snapshot/quota queries reach IndexedDB — never months
        // of old-event history, never a stray non-door query (P-IDB1).
        dehydrateOptions: {
          shouldDehydrateQuery: (query) => shouldDehydrateDoorQuery(query, Date.now(), WEEK_MS),
        },
      }}
      onSuccess={() => sweepStaleDoorQueries(client)}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
