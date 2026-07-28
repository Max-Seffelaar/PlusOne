/**
 * Tiny promise-based IndexedDB key/value store (no dependency). Backs both the
 * TanStack Query cache persister and the offline outbox, so the door survives a
 * reload while offline (spec §4: full list local, mutations queued).
 *
 * One database, one "kv" object store, namespaced string keys. SSR-safe: every
 * call no-ops to a resolved empty value when there is no `indexedDB` (server /
 * older webview without the API), so importing this never throws.
 */

const DB_NAME = 'plusone-door';
const STORE = 'kv';
const VERSION = 1;

function hasIdb(): boolean {
  return typeof indexedDB !== 'undefined';
}

let dbPromise: Promise<IDBDatabase> | null = null;
/** The live connection behind `dbPromise`, tracked so `idbClearAll` can close it
 *  before deleting the database (an open connection would otherwise defer the
 *  delete via `onblocked` until the page navigates away). */
let dbConn: IDBDatabase | null = null;

/**
 * Wipe epoch, bumped by every `idbClearAll` (sign-out). A writer captures it when
 * it SCHEDULES a write (arms a throttle timer, starts a read-merge) and re-checks
 * before committing: if the epoch moved, a wipe happened in between and the write
 * would resurrect the just-deleted door data (queued guest PII) under the next
 * user — so it's dropped. The next user's own writes carry the new epoch and work
 * normally, so this needs no reset (unlike a persistent tombstone that would
 * disable IndexedDB for whoever logs in next on the same JS context).
 */
let epoch = 0;
export function idbEpoch(): number {
  return epoch;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      dbConn = req.result;
      // A sibling tab (the Deur tab and the standalone /door/[id] route can both
      // be open) must release its connection when THIS tab runs deleteDatabase,
      // otherwise the delete blocks and the previous doorhost's data survives on
      // disk for the next one. `versionchange` is the standard signal for that.
      req.result.onversionchange = () => {
        req.result.close();
        if (dbConn === req.result) dbConn = null;
        dbPromise = null;
      };
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = run(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  if (!hasIdb()) return undefined;
  try {
    return (await tx<T>('readonly', (s) => s.get(key) as IDBRequest<T>)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Returns whether the write actually landed. Callers that only use IndexedDB
 * as a best-effort cache (the RQ persister) can ignore the result; the outbox
 * cannot — a swallowed write failure there silently drops queued check-ins on
 * the next reload (O4), so it surfaces the boolean instead of eating it.
 */
export async function idbSet<T>(key: string, value: T): Promise<boolean> {
  if (!hasIdb()) return false;
  try {
    await tx('readwrite', (s) => s.put(value as unknown as IDBValidKey & T, key));
    return true;
  } catch {
    return false;
  }
}

export async function idbDel(key: string): Promise<void> {
  if (!hasIdb()) return;
  try {
    await tx('readwrite', (s) => s.delete(key));
  } catch {
    // ignore
  }
}

/**
 * Drop the entire door store (query cache + outbox). Called on sign-out so a
 * shared venue device never serves one doorhost's guest data to the next person
 * who logs in (spec §5: personal logins on shared devices; CLAUDE.md: no PII leak).
 */
export async function idbClearAll(): Promise<void> {
  // Bump the epoch even when IndexedDB is absent, so any writer that captured the
  // old epoch still no-ops consistently.
  epoch += 1;
  if (!hasIdb()) return;
  // Close our own connection first — otherwise `deleteDatabase` is blocked and
  // deferred until the page navigates away, leaving the data readable on disk in
  // the meantime (and untestable without a real navigation). `close()` waits for
  // in-flight transactions to finish, so nothing is aborted. A sibling tab's
  // connection can still block us; the `onblocked` handler keeps us from hanging
  // and that tab's own sign-out / unload finalizes the delete.
  dbConn?.close();
  dbConn = null;
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
