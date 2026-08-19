/**
 * `indexedDB.open` blocked-handling (86ey9e9wc).
 *
 * Runs in the default `node` env; `fake-indexeddb/auto` gives a real in-memory
 * IndexedDB, so these drive the ACTUAL `blocked` event rather than asserting a
 * handler was assigned.
 *
 * The scenario is the one a future `VERSION` bump creates: a sibling connection
 * still holds the old version and does not release it (a frozen/backgrounded
 * webview whose `versionchange` handler never runs, or a busy one whose
 * `close()` is deferred behind an in-flight transaction). Since `VERSION` is a
 * module constant, the bump is simulated by rewriting the version the module
 * asks for — the blocking connection and the `blocked` event itself are real.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/observability/sentry-client', () => ({ captureMessage: vi.fn() }));

const DB_NAME = 'plusone-door';
const STORE = 'kv';

/** Captured before any spy, so the tests' own opens bypass the version rewrite. */
const realOpen = indexedDB.open.bind(indexedDB);

function rawOpen(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = realOpen(DB_NAME, version);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Let fake-indexeddb's scheduler (real `setImmediate`, deliberately not faked)
 *  deliver its queued events. */
async function flush(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i += 1) await new Promise((r) => setImmediate(r));
}

const PENDING = Symbol('pending');

/**
 * The value `p` settles with, or `PENDING` if it is still hanging after the
 * event loop has had every chance to settle it. This is what makes "hangs
 * forever" a fast, explicit assertion failure instead of a test timeout.
 */
function outcome<T>(p: Promise<T>): Promise<T | typeof PENDING> {
  return Promise.race([p, flush().then((): typeof PENDING => PENDING)]);
}

/** Fresh module instance — `idb.ts` caches its connection in module scope. */
async function loadIdb() {
  vi.resetModules();
  const idb = await import('./idb');
  const { captureMessage } = await import('@/lib/observability/sentry-client');
  return { ...idb, captureMessage: vi.mocked(captureMessage) };
}

describe('openDb — blocked on a VERSION bump (86ey9e9wc)', () => {
  /** The sibling connection that refuses to let go. No `onversionchange`
   *  handler: this is the frozen tab, not one of ours. */
  let blocker: IDBDatabase;

  beforeEach(async () => {
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });
    blocker = await rawOpen(1);
    // Only setTimeout is faked — fake-indexeddb schedules its events on
    // setImmediate, which must keep running for the `blocked` event to arrive.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    // The deploy that bumps VERSION: the module now asks for a version the
    // blocker's connection is holding open, so its open is blocked.
    vi.spyOn(indexedDB, 'open').mockImplementation((name, version) =>
      realOpen(name as string, (version ?? 1) + 1),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    blocker.close();
  });

  it('reports the write as failed once the block outlasts the grace period, instead of never settling', async () => {
    const { idbSet, IDB_OPEN_BLOCKED_GRACE_MS, captureMessage } = await loadIdb();

    const write = idbSet('door-outbox', { entries: [] });

    // Within the grace period we deliberately do NOT fail fast: a merely busy
    // sibling gets its moment to finish its transaction and close.
    expect(await outcome(write)).toBe(PENDING);
    expect(captureMessage).not.toHaveBeenCalled();

    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_GRACE_MS);

    // After it, the caller learns the write did not land. The outbox turns that
    // `false` into `persistDegraded` — a doorhost warning plus Sentry — where
    // before this fix the await simply never returned and the door hung.
    expect(await outcome(write)).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('blocked'), 'warning');
  });

  it('settles the cache restore instead of leaving the door on the restore gate', async () => {
    const { idbGet, IDB_OPEN_BLOCKED_GRACE_MS } = await loadIdb();

    // This is `restoreClient` (persister.ts): while it stays pending,
    // PersistQueryClientProvider never leaves `isRestoring` and the door waits.
    const restore = idbGet('door-query-cache');
    expect(await outcome(restore)).toBe(PENDING);

    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_GRACE_MS);

    expect(await outcome(restore)).toBeUndefined();
  });

  it('still opens normally when the blocking tab releases within the grace period', async () => {
    const { idbSet, captureMessage } = await loadIdb();

    const write = idbSet('k', 'v');
    expect(await outcome(write)).toBe(PENDING); // blocked event has fired

    // The busy tab finishes its transaction and closes — no timer has run.
    blocker.close();

    expect(await outcome(write)).toBe(true);
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('closes a connection that arrives after we gave up, so it cannot block the next version change', async () => {
    const { idbSet, IDB_OPEN_BLOCKED_GRACE_MS } = await loadIdb();

    const write = idbSet('k', 'v');
    expect(await outcome(write)).toBe(PENDING);
    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_GRACE_MS);
    expect(await outcome(write)).toBe(false);

    // The frozen tab finally dies, so the request we abandoned now completes.
    blocker.close();
    await flush();

    // That late connection must not linger. `idbClearAll` can only close the
    // connection it tracks, and this one is not it — left open it would block
    // sign-out's `deleteDatabase` (previous doorhost's guest data stays on a
    // shared device) and the next version change, which is the failure we just
    // recovered from.
    const deleteOutcome = await new Promise<string>((resolve) => {
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onsuccess = () => resolve('deleted');
      del.onblocked = () => resolve('blocked');
      del.onerror = () => resolve('error');
    });
    expect(deleteOutcome).toBe('deleted');
  });
});
