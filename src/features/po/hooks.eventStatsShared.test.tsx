// @vitest-environment jsdom
//
// Regression coverage for 86ey9e9v5: usePoEventStats (cockpit chart) and
// usePoEventActivity (Activity panel / Analytics event-first view) used to call
// the identical fetchEventStats 5-RPC bundle independently under two separate
// cache keys (poKeys.eventStats vs the now-removed poKeys.eventActivity) — every
// screen that mounted both duplicated the fetch, and invalidating one key (e.g.
// the check-in realtime hook, which only ever touched eventStats) silently left
// the other stale. Both now share poKeys.eventStats as their queryKey and vary
// the returned shape with `select`, so React Query dedupes the network call.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { JSX, ReactNode } from 'react';

const fetchEventStatsMock = vi.fn<unknown[], Promise<{
  summary: null;
  perQuarter: never[];
  tiers: never[];
  users: never[];
  refusals: never[];
}>>(async () => ({
  summary: null,
  perQuarter: [],
  tiers: [],
  users: [],
  refusals: [],
}));

vi.mock('@/features/stats/data', () => ({
  fetchEventStats: (...args: unknown[]) => fetchEventStatsMock(...args),
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));

import { usePoEventStats, usePoEventActivity } from './hooks';
import { poKeys } from './keys';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, qc };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('usePoEventStats + usePoEventActivity share one fetch (86ey9e9v5)', () => {
  it('mounting both for the same event triggers fetchEventStats exactly once', async () => {
    const { wrapper } = makeWrapper();
    const stats = renderHook(() => usePoEventStats('event-1'), { wrapper });
    const activity = renderHook(() => usePoEventActivity('event-1'), { wrapper });

    await waitFor(() => expect(stats.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(activity.result.current.isSuccess).toBe(true));

    expect(fetchEventStatsMock).toHaveBeenCalledTimes(1);
    // Each hook still gets its own shaped subset via `select`.
    expect(stats.result.current.data).toEqual({ perKwartier: [], peak: null, peakCount: 0 });
    expect(activity.result.current.data).toEqual({
      ek: { peak: null, peakCount: 0, noShows: 0, noShowPct: 0 },
      perKwartier: [],
      perTier: [],
      perUser: [],
    });
  });

  it('both hooks read/write the same poKeys.eventStats cache entry', async () => {
    const { wrapper, qc } = makeWrapper();
    const { result } = renderHook(() => usePoEventStats('event-1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(qc.getQueryData(poKeys.eventStats('event-1'))).toBeDefined();
  });
});
