import { describe, expect, it } from 'vitest';
import { oldestDataUpdatedAt, type QueryFreshness } from './cockpitFreshness';

const q = (dataUpdatedAt: number): QueryFreshness => ({ dataUpdatedAt });

describe('oldestDataUpdatedAt', () => {
  it('returns the OLDEST stamp, not the newest', () => {
    // The whole point of the guard: one query that refetched a second ago does
    // not make a screen fresh when the other three are hours old.
    expect(oldestDataUpdatedAt([q(1_000), q(9_000), q(5_000)])).toBe(1_000);
  });

  it('returns the single stamp for a one-query set', () => {
    expect(oldestDataUpdatedAt([q(4_242)])).toBe(4_242);
  });

  it('treats a never-loaded query (dataUpdatedAt 0) as never synced', () => {
    // Even surrounded by perfectly fresh siblings — part of the screen has no
    // truth behind it at all, which is at least as bad as an old truth.
    expect(oldestDataUpdatedAt([q(9_000), q(0), q(9_000)])).toBeNull();
  });

  it('treats a negative stamp as never synced', () => {
    expect(oldestDataUpdatedAt([q(9_000), q(-1)])).toBeNull();
  });

  it('proves nothing from an empty set', () => {
    expect(oldestDataUpdatedAt([])).toBeNull();
  });
});


describe('oldestDataUpdatedAt — the veto property', () => {
  it('lets ONE never-succeeding query pin the whole set at "never synced"', () => {
    // This is why membership in `tracked` is a deliberate, narrow decision
    // (86eykg2x1 review round 2). React Query leaves `dataUpdatedAt` at 0 until
    // a query's first success, so a read that never succeeds never gets a stamp
    // — no forced refresh can move this result off null, on any surface.
    const brokenForever = q(0);
    const fresh = [q(9_000), q(9_500), q(9_900)];
    expect(oldestDataUpdatedAt(fresh)).toBe(9_000);
    expect(oldestDataUpdatedAt([...fresh, brokenForever])).toBeNull();
  });

  it('keeps the LAST good stamp of a query whose refetches now fail, so it ages out', () => {
    // The other half of the same veto: a query that succeeded once and then
    // started failing keeps its old stamp, which simply drifts past the
    // threshold and pins the set stale from below.
    expect(oldestDataUpdatedAt([q(9_000), q(1_000)])).toBe(1_000);
  });
});
