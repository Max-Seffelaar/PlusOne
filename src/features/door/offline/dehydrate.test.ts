import { describe, expect, it } from 'vitest';
import type { Query } from '@tanstack/react-query';
import { isDoorQueryKey, isStaleDoorQuery, shouldDehydrateDoorQuery } from './dehydrate';

const WEEK = 1000 * 60 * 60 * 24 * 7;
const NOW = 1_760_000_000_000;

/** Minimal Query stand-in — only the fields the predicates read. */
function q(over: {
  key?: readonly unknown[];
  status?: 'success' | 'pending' | 'error';
  updatedAt?: number;
  observers?: number;
  /** Defaults to data present for `success`, absent otherwise. */
  data?: unknown;
}): Query {
  const status = over.status ?? 'success';
  const data = 'data' in over ? over.data : status === 'success' ? { guests: [] } : undefined;
  return {
    queryKey: over.key ?? ['door', 'ev1'],
    state: { status, data, dataUpdatedAt: data === undefined ? 0 : (over.updatedAt ?? NOW) },
    getObserversCount: () => over.observers ?? 0,
  } as unknown as Query;
}

describe('isDoorQueryKey', () => {
  it('matches the door snapshot + quota roots only', () => {
    expect(isDoorQueryKey(['door', 'ev1'])).toBe(true);
    expect(isDoorQueryKey(['door-quota', 'ev1'])).toBe(true);
    expect(isDoorQueryKey(['guests', 'ev1'])).toBe(false);
    expect(isDoorQueryKey([])).toBe(false);
    expect(isDoorQueryKey([42])).toBe(false);
  });
});

describe('shouldDehydrateDoorQuery (P-IDB1)', () => {
  it('persists a fresh, successful door query', () => {
    expect(shouldDehydrateDoorQuery(q({ updatedAt: NOW }), NOW, WEEK)).toBe(true);
    expect(shouldDehydrateDoorQuery(q({ key: ['door-quota', 'ev1'] }), NOW, WEEK)).toBe(true);
  });

  it('evicts a door query older than maxAge — the never-shrinking-history bug', () => {
    const monthsOld = NOW - WEEK * 12;
    expect(shouldDehydrateDoorQuery(q({ updatedAt: monthsOld }), NOW, WEEK)).toBe(false);
  });

  it('keeps a query exactly at the maxAge boundary (inclusive)', () => {
    expect(shouldDehydrateDoorQuery(q({ updatedAt: NOW - WEEK }), NOW, WEEK)).toBe(true);
    expect(shouldDehydrateDoorQuery(q({ updatedAt: NOW - WEEK - 1 }), NOW, WEEK)).toBe(false);
  });

  it('never persists a non-door query, even a fresh one', () => {
    expect(shouldDehydrateDoorQuery(q({ key: ['guests', 'ev1'] }), NOW, WEEK)).toBe(false);
  });

  it('never persists a query without data (no error/pending garbage in the blob)', () => {
    expect(shouldDehydrateDoorQuery(q({ status: 'error' }), NOW, WEEK)).toBe(false);
    expect(shouldDehydrateDoorQuery(q({ status: 'pending' }), NOW, WEEK)).toBe(false);
  });

  it('KEEPS a snapshot whose offline refetch failed — error status, data retained (N7)', () => {
    // Dropping it here overwrote the IndexedDB snapshot without the guest list,
    // so the second offline reload booted an empty door.
    expect(shouldDehydrateDoorQuery(q({ status: 'error', data: { guests: [] } }), NOW, WEEK)).toBe(true);
    // ...still subject to the recency gate on the age of that data.
    expect(
      shouldDehydrateDoorQuery(q({ status: 'error', data: { guests: [] }, updatedAt: NOW - WEEK * 12 }), NOW, WEEK),
    ).toBe(false);
  });
});

describe('isStaleDoorQuery (boot sweep)', () => {
  it('sweeps a stale, unobserved door query', () => {
    expect(isStaleDoorQuery(q({ updatedAt: NOW - WEEK * 12, observers: 0 }), NOW, WEEK)).toBe(true);
  });

  it('never sweeps the active (observed) event, even if its data went stale offline', () => {
    expect(isStaleDoorQuery(q({ updatedAt: NOW - WEEK * 12, observers: 1 }), NOW, WEEK)).toBe(false);
  });

  it('never sweeps a fresh query, and never a non-door query', () => {
    expect(isStaleDoorQuery(q({ updatedAt: NOW }), NOW, WEEK)).toBe(false);
    expect(isStaleDoorQuery(q({ key: ['guests', 'ev1'], updatedAt: NOW - WEEK * 12 }), NOW, WEEK)).toBe(false);
  });
});
