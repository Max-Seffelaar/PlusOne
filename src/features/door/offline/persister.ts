/**
 * IndexedDB persister for the TanStack Query cache (decision #25, spec §4): the
 * full guest snapshot is written to IndexedDB so the door opens instantly and
 * works after a reload with no network. localStorage would be too small for a
 * 150-guest event; IndexedDB is the right store.
 */
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { idbDel, idbGet, idbSet } from './idb';

const CACHE_KEY = 'door-query-cache';

export function createIdbPersister(key = CACHE_KEY): Persister {
  return {
    persistClient: (client: PersistedClient) => {
      void idbSet(key, client);
    },
    restoreClient: () => idbGet<PersistedClient>(key),
    removeClient: () => idbDel(key),
  };
}
