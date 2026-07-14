import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { idbEpoch, idbGet, idbSet } from '../offline/idb';
import { buildEnvelope } from './persistence';
import { OutboxStore } from './store';
import type { OutboxEntry, OutboxStatus } from './types';

vi.mock('../offline/idb', () => ({ idbGet: vi.fn(), idbSet: vi.fn(), idbEpoch: vi.fn(() => 0) }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

// A Node MaxListenersExceededWarning may print for this file: store.ts's
// `export const outbox = new OutboxStore()` singleton constructs (and calls
// getChannel()) at MODULE IMPORT time, before any hook here could stub
// BroadcastChannel — so every `new OutboxStore()` in these tests registers
// one more listener on the one real, module-memoized channel. It's benign:
// BroadcastChannel excludes an object from its own postMessage (verified
// directly — a channel never receives a message it posted itself), and every
// OutboxStore instance in this file shares that exact one object, so no
// cross-test message delivery can ever actually happen. Cosmetic only.

const idbGetMock = vi.mocked(idbGet);
const idbSetMock = vi.mocked(idbSet);
const idbEpochMock = vi.mocked(idbEpoch);

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CI_ID = '22222222-2222-4222-8222-222222222222';
const GUEST_ID = '33333333-3333-4333-8333-333333333333';

function entry(clientId: string, status: OutboxStatus = 'pending'): OutboxEntry {
  return {
    clientId,
    eventId: EVENT_ID,
    kind: 'check_in',
    status,
    attempts: 0,
    createdAt: '2026-07-13T20:00:00.000Z',
    payload: { id: CI_ID, guestId: GUEST_ID, plusOnesArrived: 0, clientTimestamp: '2026-07-13T20:00:00.000Z' },
  };
}

function createDeferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): a `mockResolvedValue` default set by
  // one test is an implementation, not just call history — clearAllMocks
  // leaves it in place and it silently leaks into the next test's unqueued
  // idbGet() calls. Every test must set its own idbGetMock behavior explicitly.
  vi.resetAllMocks();
  idbSetMock.mockResolvedValue(true);
  idbEpochMock.mockReturnValue(0); // resetAllMocks cleared its implementation
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OutboxStore.init (O9 — IndexedDB absent or corrupt)', () => {
  it('loads to an empty, non-throwing queue when IndexedDB has nothing stored', async () => {
    idbGetMock.mockResolvedValue(undefined);
    const store = new OutboxStore();
    await expect(store.init()).resolves.toBeUndefined();
    expect(store.getSnapshot()).toEqual([]);
  });

  it('quarantines a corrupt/unrecognized persisted shape instead of crashing', async () => {
    idbGetMock.mockResolvedValue({ totally: 'not-an-outbox' });
    const { captureMessage } = await import('@sentry/nextjs');
    const store = new OutboxStore();
    await expect(store.init()).resolves.toBeUndefined();
    expect(store.getSnapshot()).toEqual([]);
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('stale/unrecognized'), 'warning');
  });
});

describe('OutboxStore.init (O5 — enqueue during the init() await window)', () => {
  it('keeps an entry enqueued while init() is still awaiting its IndexedDB read', async () => {
    const deferred = createDeferred<unknown>();
    idbGetMock.mockImplementationOnce(() => deferred.promise as Promise<unknown>);
    idbGetMock.mockResolvedValue(undefined); // persistMerged()'s follow-up read: nothing else on disk

    const store = new OutboxStore();
    const initPromise = store.init();

    // Simulate a checkIn() firing in the window between init()'s read starting
    // and it resolving — the old code silently dropped this (O5).
    store.enqueue(entry('mid-await'));

    deferred.resolve(undefined);
    await initPromise;

    expect(store.getSnapshot().map((e) => e.clientId)).toEqual(['mid-await']);
  });
});

describe('OutboxStore.init — C8 crash-recovery revival must survive its own flush', () => {
  it('keeps a revived syncing→pending entry pending after the flush, not reverted back by the merge', async () => {
    // Disk is unchanged between init()'s own read and persistMerged()'s
    // follow-up read — nothing has written yet, which is exactly what let a
    // plain rank-based merge revert the revival back to `syncing` (review
    // 2026-07-14: the merge ranks `syncing` above the freshly-revived
    // `pending` and picks disk's stale copy). Every earlier test mocked this
    // second read as `undefined`, which masked the bug entirely.
    const stuck = buildEnvelope([entry('a', 'syncing')]);
    idbGetMock.mockResolvedValue(stuck);

    const store = new OutboxStore();
    await store.init();

    expect(store.getSnapshot()[0].status).toBe('pending');

    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalled());
    const [, persistedValue] = idbSetMock.mock.calls.at(-1) ?? [];
    expect((persistedValue as { entries: OutboxEntry[] }).entries[0].status).toBe('pending');
    // Still pending once the flush has fully settled — not reverted back.
    expect(store.getSnapshot()[0].status).toBe('pending');
  });
});

describe('OutboxStore.retryErrors — same revert risk, same fix', () => {
  it('keeps a retried error→pending entry pending and resets attempts, surviving its own flush', async () => {
    idbGetMock.mockResolvedValue(undefined); // init(): nothing on disk yet
    const store = new OutboxStore();
    await store.init();
    store.enqueue({ ...entry('a', 'error'), attempts: 5 });
    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalled());

    // Disk still holds the pre-retry `error` at the moment retryErrors()
    // flushes — identical shape to the init() revival bug.
    idbGetMock.mockResolvedValue(buildEnvelope([{ ...entry('a', 'error'), attempts: 5 }]));
    store.retryErrors();
    await vi.waitFor(() => expect(idbSetMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    const live = store.getSnapshot()[0];
    expect(live.status).toBe('pending');
    // A manual retry is a fresh attempt — an entry that had already
    // dead-lettered at MAX_ATTEMPTS must not get only one more try.
    expect(live.attempts).toBe(0);
    const [, persistedValue] = idbSetMock.mock.calls.at(-1) ?? [];
    const persistedEntry = (persistedValue as { entries: OutboxEntry[] }).entries[0];
    expect(persistedEntry.status).toBe('pending');
    expect(persistedEntry.attempts).toBe(0);
  });
});

describe('OutboxStore — read-merge-before-commit (O1 — cross-tab last-writer-wins)', () => {
  it('never overwrites entries a sibling tab wrote since our last read', async () => {
    idbGetMock.mockResolvedValueOnce(undefined); // init(): nothing on disk yet
    const store = new OutboxStore();
    await store.init();

    // A sibling tab (different OutboxStore instance) commits an entry to disk
    // right as we're about to commit our own — persistMerged's own read must
    // pick it up instead of clobbering it with a blind overwrite.
    idbGetMock.mockResolvedValueOnce(buildEnvelope([entry('sibling-tab')]));

    store.enqueue(entry('this-tab'));
    // commit() -> persistMerged() is fire-and-forget; wait for it to land instead
    // of guessing a microtask-tick count.
    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalled());

    const ids = store.getSnapshot().map((e) => e.clientId).sort();
    expect(ids).toEqual(['sibling-tab', 'this-tab']);
    const [, persistedValue] = idbSetMock.mock.calls.at(-1) ?? [];
    expect((persistedValue as { entries: OutboxEntry[] }).entries.map((e) => e.clientId).sort()).toEqual([
      'sibling-tab',
      'this-tab',
    ]);
  });

  it('clearSynced() removal survives even when a sibling tab still has the synced entry on disk', async () => {
    idbGetMock.mockResolvedValueOnce(undefined); // init(): nothing on disk yet
    const store = new OutboxStore();
    await store.init();
    idbGetMock.mockResolvedValueOnce(undefined); // enqueue()'s flush: still nothing on disk yet
    store.enqueue(entry('done', 'synced'));
    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalled());

    // A sibling tab hasn't cleared it yet — its stale on-disk copy still has
    // 'done'. A plain merge would resurrect it; the removal must stick anyway.
    idbGetMock.mockResolvedValueOnce(buildEnvelope([entry('done', 'synced')]));
    store.clearSynced();
    await vi.waitFor(() => expect(idbSetMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(store.getSnapshot().map((e) => e.clientId)).toEqual([]);
    const [, persistedValue] = idbSetMock.mock.calls.at(-1) ?? [];
    expect((persistedValue as { entries: OutboxEntry[] }).entries).toEqual([]);
  });
});

describe('OutboxStore — stuck Web Lock does not disable persistence', () => {
  it('degrades to the unlocked write once the lock-request times out', async () => {
    idbGetMock.mockResolvedValue(undefined);

    // A lock held forever — mirrors a wedged sibling tab, a hung extension, or
    // a same-origin script squatting on the lock name. The real Web Locks API
    // rejects the request promise with the AbortSignal's reason once it fires;
    // `run` (the callback) is never invoked in that case, matching the spec.
    vi.stubGlobal('navigator', {
      locks: {
        request: (_name: string, opts: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal?.addEventListener('abort', () => reject(opts.signal?.reason));
          }),
      },
    });

    const store = new OutboxStore();
    await store.init();
    store.enqueue(entry('a'));

    // The fix's hardcoded 2s AbortSignal.timeout must trip and the write must
    // still land — a stuck lock must not silently switch off durability.
    await vi.waitFor(() => expect(idbSetMock).toHaveBeenCalled(), { timeout: 4000 });
    expect(store.getSnapshot().map((e) => e.clientId)).toEqual(['a']);
  }, 8000);
});

describe('OutboxStore — persist-failure surfacing (O4)', () => {
  it('flags persistDegraded and reports to Sentry when the IndexedDB write fails', async () => {
    idbGetMock.mockResolvedValue(undefined);
    idbSetMock.mockResolvedValue(false);
    const { captureMessage } = await import('@sentry/nextjs');
    const store = new OutboxStore();
    await store.init();

    expect(store.getStatusSnapshot()).toBe(false);
    store.enqueue(entry('a'));
    await vi.waitFor(() => expect(store.getStatusSnapshot()).toBe(true));

    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining('IndexedDB write failed'), 'warning');
  });

  it('does not re-report on every subsequent failed write (edge-triggered)', async () => {
    idbGetMock.mockResolvedValue(undefined);
    idbSetMock.mockResolvedValue(false);
    const { captureMessage } = await import('@sentry/nextjs');
    const store = new OutboxStore();
    await store.init();
    store.enqueue(entry('a'));
    await vi.waitFor(() => expect(store.getStatusSnapshot()).toBe(true));
    store.enqueue(entry('b'));
    await vi.waitFor(() => expect(idbSetMock.mock.calls.length).toBeGreaterThanOrEqual(2));

    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});

describe('OutboxStore — sign-out isolation (86ey9et07)', () => {
  it('reset() empties the in-memory queue and marks it unloaded', async () => {
    idbGetMock.mockResolvedValue(buildEnvelope([entry('a'), entry('b')]));
    const store = new OutboxStore();
    await store.init();
    expect(store.getSnapshot()).toHaveLength(2);

    store.reset();

    // getSnapshot() returns the empty ref while !loaded — the next doorhost on a
    // shared device inherits nothing, and their init() re-reads the clean DB.
    expect(store.getSnapshot()).toEqual([]);
  });

  it('does not re-persist an in-flight commit once a sign-out wipe bumped the epoch', async () => {
    idbGetMock.mockResolvedValueOnce(buildEnvelope([])); // init()'s read
    const store = new OutboxStore();
    await store.init(); // loaded, epoch 0
    idbSetMock.mockClear();

    // A last optimistic mutation kicks off persistMerged, whose read-merge hangs…
    const readDeferred = createDeferred<unknown>();
    idbGetMock.mockReturnValue(readDeferred.promise as Promise<unknown>);
    store.enqueue(entry('late'));

    // …meanwhile the doorhost signs out: idbClearAll() bumped the epoch.
    idbEpochMock.mockReturnValue(1);
    readDeferred.resolve(buildEnvelope([]));
    await Promise.resolve();
    await Promise.resolve();

    // The merge bails post-read instead of writing A's entry into the fresh DB.
    expect(idbSetMock).not.toHaveBeenCalled();
  });
});
