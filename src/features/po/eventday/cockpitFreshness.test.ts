import { describe, expect, it } from 'vitest';
import { anyQueryInFlight, oldestDataUpdatedAt, type QueryFreshness } from './cockpitFreshness';

const q = (dataUpdatedAt: number, fetchStatus: QueryFreshness['fetchStatus'] = 'idle'): QueryFreshness => ({
  dataUpdatedAt,
  fetchStatus,
});

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

describe('anyQueryInFlight', () => {
  it('is false when every query is idle', () => {
    expect(anyQueryInFlight([q(1), q(2), q(3)])).toBe(false);
  });

  it('is true while any query is fetching', () => {
    expect(anyQueryInFlight([q(1), q(2, 'fetching'), q(3)])).toBe(true);
  });

  it('counts a PAUSED query as in flight', () => {
    // React Query pauses rather than runs a refetch when it believes the device
    // is offline. The attempt exists and resumes by itself once connectivity is
    // back, so reporting it as settled would tell the guard the refresh already
    // failed when it has not been tried yet.
    expect(anyQueryInFlight([q(1), q(2, 'paused')])).toBe(true);
  });

  it('is false for an empty set', () => {
    expect(anyQueryInFlight([])).toBe(false);
  });
});
