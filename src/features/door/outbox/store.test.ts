import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idbGet, idbSet } from '../offline/idb';
import { buildEnvelope } from './persistence';
import { OutboxStore } from './store';
import type { OutboxEntry, OutboxStatus } from './types';

vi.mock('../offline/idb', () => ({ idbGet: vi.fn(), idbSet: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

const idbGetMock = vi.mocked(idbGet);
const idbSetMock = vi.mocked(idbSet);

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
  vi.clearAllMocks();
  idbSetMock.mockResolvedValue(true);
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
