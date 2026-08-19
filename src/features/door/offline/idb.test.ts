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

  it('does not adopt an attempt that a sign-out wipe landed on, so a pre-wipe write cannot reach the next doorhost (review 86ey9e9wc)', async () => {
    const { idbSet, idbClearAll } = await loadIdb();

    // Doorhost A's outbox write parks inside `openDb` — blocked by the sibling.
    const write = idbSet('door-outbox', { entries: ['A: Alice +2 (PII)'] });
    expect(await outcome(write)).toBe(PENDING);

    // A signs out. `idbClearAll` bumps the epoch synchronously, closes what it
    // tracks (nothing yet — this attempt never resolved) and deletes the database.
    const wipe = idbClearAll();

    // Mid-wipe, the frozen tab dies — well inside the grace period, so the attempt
    // above has NOT given up and its `settled` flag is still false. This is the
    // window the give-up branch cannot cover.
    blocker.close();
    await wipe;
    await flush();

    // Without the epoch guard this attempt takes the success path: it adopts the
    // connection as `dbConn` and resolves, and A's write — which passed the
    // outbox's own epoch check BEFORE it parked in `openDb` — lands in the
    // database the next doorhost will boot on. It must report failure instead.
    expect(await outcome(write)).toBe(false);

    // WHAT THIS TEST DOES NOT CAPTURE — checked, not assumed. The downstream
    // consequences of the adoption were both probed against the unfixed code and
    // came out GREEN under fake-indexeddb, so asserting them here would be a test
    // that can never fail:
    //   - A's record surviving on disk after the wipe (`deleteDatabase` still
    //     wins the race in this harness, so the bytes go);
    //   - the adopted connection blocking a later `deleteDatabase` once a
    //     subsequent `openDb` has overwritten `dbConn` (reports 'deleted', not
    //     'blocked').
    // Both depend on browser event ordering that fake-indexeddb does not model.
    // What IS deterministic — and is what the assertion above pins — is the step
    // they all hang off: a post-wipe attempt being adopted and its pre-wipe write
    // reported as landed. Fix that and the rest cannot follow.
  });

  it('fails fast during the cooldown instead of paying another grace period and another Sentry event', async () => {
    const { idbSet, IDB_OPEN_BLOCKED_GRACE_MS, IDB_OPEN_BLOCKED_COOLDOWN_MS, captureMessage } = await loadIdb();

    const first = idbSet('k', 'v');
    expect(await outcome(first)).toBe(PENDING);
    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_GRACE_MS);
    expect(await outcome(first)).toBe(false);
    expect(captureMessage).toHaveBeenCalledTimes(1);

    // The blocking tab is still frozen. persister.ts (2 s throttle), every
    // `outbox.commit()` and the 60 s safety sync keep calling in. Each such call
    // must NOT arm its own grace period — it settles immediately, with no second
    // report, so a frozen sibling cannot turn into a repeating 2 s cycle.
    const during = idbSet('k', 'v2');
    expect(await outcome(during)).toBe(false); // settled without advancing any timer
    expect(captureMessage).toHaveBeenCalledTimes(1);

    // Once the cooldown expires we retry for real: recovery is not given up on,
    // it is only rate-limited. The sibling is gone now, so this one succeeds.
    blocker.close();
    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_COOLDOWN_MS);
    expect(await outcome(idbSet('k', 'v3'))).toBe(true);
  });

  it('gives the boot restore the longer grace, so a slow-but-healthy sibling does not cost the door its cache', async () => {
    const { IDB_OPEN_BLOCKED_GRACE_MS, IDB_OPEN_BLOCKED_RESTORE_GRACE_MS } = await loadIdb();
    const { createIdbPersister } = await import('./persister');

    const restore = createIdbPersister().restoreClient() as Promise<unknown>;
    expect(await outcome(restore)).toBe(PENDING);

    // Past the WRITE grace a write would already have given up. The restore has
    // not: this is the low-end webview whose healthy sibling takes seconds to
    // release, where failing would drop the cached guest list with no refetch.
    vi.advanceTimersByTime(IDB_OPEN_BLOCKED_GRACE_MS + 1);
    expect(await outcome(restore)).toBe(PENDING);

    // It releases in time, so the door keeps its cache (empty here — the point is
    // that the open succeeded rather than being abandoned).
    blocker.close();
    expect(await outcome(restore)).toBeUndefined();
    expect(IDB_OPEN_BLOCKED_RESTORE_GRACE_MS).toBeGreaterThan(IDB_OPEN_BLOCKED_GRACE_MS);
  });
});
