// @vitest-environment jsdom
//
// Regression coverage for C19 (2026-07 review P3, ClickUp 86ey6xdkb):
// usePoEventRealtime's invalidate() previously omitted eventDetail — a peer's
// check-in/void never refreshed the event-detail header. Asserts the full
// invalidated key-list on a postgres_changes callback, not just the pre-fix subset.
//
// 86ey9e8hz updated this: the venue-wide All-Guests tab (VENUE_GUESTS_PREFIX) is
// NO LONGER invalidated per check-in — that tab is a server-windowed working set,
// and re-downloading it on every check-in during a rush is the cost the windowing
// removed. It still refreshes on guest WRITES (the mutation paths keep the prefix).
//
// Also covers 86ey9e8fe: invalidate() is throttled (leading+trailing) so a
// burst of postgres_changes events (a check-in touches BOTH guests AND
// check_ins) collapses into at most 2 invalidate cycles instead of firing the
// full cascade once per event.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

interface FakeChannel {
  on: (event: string, filter: unknown, cb: () => void) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
}

const handlers: Array<() => void> = [];
const channelChain: FakeChannel = {
  on: vi.fn((_event: string, _filter: unknown, cb: () => void) => {
    handlers.push(cb);
    return channelChain;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    // First-ever SUBSCRIBED must NOT itself trigger an invalidate (that would
    // double-fetch on mount) — mirrors src/features/door/sync/reconnect.ts.
    cb('SUBSCRIBED');
    return channelChain;
  }),
};
const fakeDoorClient = {
  auth: { getSession: vi.fn(async () => ({ data: { session: { access_token: 'tok' } } })) },
  realtime: { setAuth: vi.fn() },
  channel: vi.fn(() => channelChain),
  removeChannel: vi.fn(),
};

vi.mock('@/features/door/offline/device', () => ({
  getDoorClient: () => fakeDoorClient,
  getDeviceId: () => 'device-1',
}));

import { usePoEventRealtime } from './hooks';
import { poKeys } from './keys';
import { VENUE_GUESTS_PREFIX } from './mutations';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, spy };
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

function includesKey(keys: unknown[], expected: readonly unknown[]): boolean {
  return keys.some((k) => JSON.stringify(k) === JSON.stringify(expected));
}

afterEach(() => {
  vi.clearAllMocks();
  handlers.length = 0;
});

describe('usePoEventRealtime invalidate() (C19, 86ey6xdkb / 86ey9e8hz)', () => {
  it('a postgres_changes event invalidates guests, tiers, arrivals, event-stats AND event-detail — but NOT venue-guests', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoEventRealtime('event-1'), { wrapper });

    await waitFor(() => expect(result.current.realtimeConnected).toBe(true));
    expect(handlers.length).toBeGreaterThan(0); // both 'guests' and 'check_ins' subscriptions registered

    act(() => handlers.forEach((h) => h()));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.tiers('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.eventStats('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.eventDetail('event-1'))).toBe(true);
    // 86ey9e8hz: the windowed venue-wide All-Guests tab is NOT re-downloaded per
    // check-in; only guest writes (mutation paths) invalidate this prefix.
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(false);
  });
});

describe('usePoEventRealtime invalidate() throttling (86ey9e8fe)', () => {
  it('a burst of postgres_changes events fires the 5-key cascade only twice (leading + trailing), not once per event', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoEventRealtime('event-1'), { wrapper });

    // Establish the connection on real timers first — fake timers don't mock
    // the promise microtask chain, but mixing them with testing-library's
    // waitFor internals is fragile.
    await waitFor(() => expect(result.current.realtimeConnected).toBe(true));
    expect(handlers.length).toBeGreaterThan(0);
    spy.mockClear();

    vi.useFakeTimers();
    try {
      // One check-in touches BOTH `guests` and `check_ins` — simulate that plus
      // a few peers' check-ins landing in the same door-rush burst.
      act(() => {
        for (let i = 0; i < 8; i++) handlers.forEach((h) => h());
      });

      // Leading edge already fired once synchronously (5 keys: guests, tiers,
      // arrivals, event-stats, event-detail — venue-guests dropped in 86ey9e8hz).
      expect(spy.mock.calls.length).toBe(5);

      act(() => vi.advanceTimersByTime(600));

      // Trailing edge closes the burst with exactly one more cascade — NOT one
      // cascade per one of the 16 events that fired above (86ey9e8fe: ~20
      // requests/check-in came from firing the full cascade per event).
      expect(spy.mock.calls.length).toBe(10);
    } finally {
      vi.useRealTimers();
    }
  });
});
