/**
 * IndexedDB persister for the TanStack Query cache (decision #25, spec §4): the
 * full guest snapshot is written to IndexedDB so the door opens instantly and
 * works after a reload with no network. localStorage would be too small for a
 * 150-guest event; IndexedDB is the right store.
 *
 * THROTTLED (P-IDB2): `persistQueryClientSubscribe` calls back on EVERY cache
 * event, and it does not throttle — so without this, each optimistic check-in and
 * each realtime patch would trigger a full `dehydrate()` + a full IndexedDB write
 * on the main thread. During a check-in rush that is a burst of 50–200ms stalls
 * on a mid-range door phone. We coalesce: keep only the latest client and write
 * at most once per `throttleMs` (trailing edge). The dehydrated snapshot is a
 * disposable cache — the durable offline outbox lives under a separate IDB key
 * (`door-outbox`), so a coalesced/dropped final write never loses a mutation; the
 * worst case is a refetch on next boot.
 */
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';
import { IDB_OPEN_BLOCKED_RESTORE_GRACE_MS, idbDel, idbEpoch, idbGet, idbSet } from './idb';

const CACHE_KEY = 'door-query-cache';

/** Min gap between IndexedDB writes of the snapshot cache (trailing throttle). */
export const PERSIST_THROTTLE_MS = 2000;

export function createIdbPersister(key = CACHE_KEY, throttleMs = PERSIST_THROTTLE_MS): Persister {
  let pending: PersistedClient | null = null;
  let pendingEpoch = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const write = (): void => {
    timer = null;
    const client = pending;
    pending = null;
    // Drop a write that was scheduled before a sign-out wipe (epoch bumped since
    // we armed the timer). Otherwise this trailing write re-creates the
    // just-deleted `plusone-door` DB and re-persists the previous doorhost's
    // guest snapshot for the next person on a shared tablet (86ey9et07).
    if (client && pendingEpoch === idbEpoch()) void idbSet(key, client);
  };

  return {
    // Store only the newest client; the first call in a window arms the timer,
    // later calls within it just replace `pending` → one write per window.
    persistClient: (client: PersistedClient) => {
      pending = client;
      pendingEpoch = idbEpoch();
      timer ??= setTimeout(write, throttleMs);
    },
    // The boot gate: while this is pending PersistQueryClientProvider stays in
    // `isRestoring`. It gets the LONGER blocked-open grace — losing this read
    // costs the whole cached guest list, and at the door offline is the normal
    // case, so there is no refetch to fall back on (writes, which nothing waits
    // on, keep the short one). See the constants in `idb.ts`.
    //
    // DECIDED, not overlooked (86ey9e9wc review): a restore that fails anyway is
    // still SILENT — `idbGet` swallows the rejection and returns `undefined`,
    // which is indistinguishable from a cold cache, so the door boots on an empty
    // list with no storage-attributable warning (the `persistDegraded` toast only
    // fires once a WRITE fails, and it describes a different problem). Telemetry
    // does cover it (`captureMessage` on give-up, in `idb.ts`). A doorhost-facing
    // "your cached list could not be loaded" signal is deliberately NOT added here:
    // it applies to every restore failure (corrupt snapshot, quota exceeded), not
    // just a blocked open, so it belongs to `restoreClient`'s error contract and
    // its own UI decision — not bolted onto this fix. Own task.
    restoreClient: () => idbGet<PersistedClient>(key, { graceMs: IDB_OPEN_BLOCKED_RESTORE_GRACE_MS }),
    // Cancel any queued write first: a throttled stale write firing after
    // removeClient would resurrect a cache we were told to discard (corrupt
    // restore, or sign-out clearing PII on a shared door phone).
    removeClient: () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
      return idbDel(key);
    },
  };
}

let sharedDoorPersister: Persister | null = null;

/**
 * Session-stable persister paired with getDoorQueryClient (86ey9e8pm). Recreating
 * a persister per DoorQueryProvider mount re-subscribes + re-restores from
 * IndexedDB on every Deur-tab re-entry for nothing; one instance across the tab
 * session avoids that churn and matches the reused client.
 */
export function getDoorPersister(): Persister {
  return (sharedDoorPersister ??= createIdbPersister());
}
