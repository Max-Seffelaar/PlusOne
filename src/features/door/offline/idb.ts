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

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
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

export async function idbSet<T>(key: string, value: T): Promise<void> {
  if (!hasIdb()) return;
  try {
    await tx('readwrite', (s) => s.put(value as unknown as IDBValidKey & T, key));
  } catch {
    // Best-effort cache; a write failure must never break the door UI.
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
  if (!hasIdb()) return;
  dbPromise = null;
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
