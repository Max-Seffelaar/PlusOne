// Regression coverage for R6/86ey9e8fe: fetchCheckinArrivals returns a fresh
// `Map` on every fetch, which defeats React Query's default structural sharing
// (it only deep-compares plain objects/arrays) — every refetch got a new Map
// identity even when nothing changed, invalidating the arrivals-keyed memos
// downstream (tiles/tierRows, CockpitGuestList). arrivalsEqual is the content
// check usePoCheckinArrivals' structuralSharing option uses to keep the old
// reference when the content didn't actually change.
import { describe, expect, it } from 'vitest';
import { arrivalsEqual } from './hooks';

function arrivals(entries: Array<[string, { arrived: number; at: string }]>) {
  return new Map(entries);
}

describe('arrivalsEqual (86ey9e8fe)', () => {
  it('is true for the same reference', () => {
    const a = arrivals([['g1', { arrived: 2, at: '2026-07-14T20:00:00Z' }]]);
    expect(arrivalsEqual(a, a)).toBe(true);
  });

  it('is true for two distinct Maps with identical entries', () => {
    const a = arrivals([['g1', { arrived: 2, at: '2026-07-14T20:00:00Z' }]]);
    const b = arrivals([['g1', { arrived: 2, at: '2026-07-14T20:00:00Z' }]]);
    expect(arrivalsEqual(a, b)).toBe(true);
  });

  it('is false when a guest\'s arrived count differs', () => {
    const a = arrivals([['g1', { arrived: 1, at: '2026-07-14T20:00:00Z' }]]);
    const b = arrivals([['g1', { arrived: 2, at: '2026-07-14T20:00:00Z' }]]);
    expect(arrivalsEqual(a, b)).toBe(false);
  });

  it('is false when the size differs (a new guest arrived)', () => {
    const a = arrivals([['g1', { arrived: 1, at: '2026-07-14T20:00:00Z' }]]);
    const b = arrivals([
      ['g1', { arrived: 1, at: '2026-07-14T20:00:00Z' }],
      ['g2', { arrived: 0, at: '2026-07-14T20:05:00Z' }],
    ]);
    expect(arrivalsEqual(a, b)).toBe(false);
  });

  it('is false when a guest is missing from the other map', () => {
    const a = arrivals([['g1', { arrived: 1, at: '2026-07-14T20:00:00Z' }]]);
    const b = arrivals([['g2', { arrived: 1, at: '2026-07-14T20:00:00Z' }]]);
    expect(arrivalsEqual(a, b)).toBe(false);
  });

  it('is true for two empty maps', () => {
    expect(arrivalsEqual(arrivals([]), arrivals([]))).toBe(true);
  });
});
