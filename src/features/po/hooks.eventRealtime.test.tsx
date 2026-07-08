// @vitest-environment jsdom
//
// Regression coverage for C19 (2026-07 review P3, ClickUp 86ey6xdkb):
// usePoEventRealtime's invalidate() previously omitted venue-guests AND
// eventDetail — a peer's check-in/void never refreshed the All-Guests tab or
// the event-detail header. Asserts the full invalidated key-list on a
// postgres_changes callback, not just the pre-fix subset.
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

describe('usePoEventRealtime invalidate() (C19, 86ey6xdkb)', () => {
  it('a postgres_changes event invalidates guests, tiers, arrivals, event-stats, venue-guests AND event-detail', async () => {
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
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
    expect(includesKey(keys, poKeys.eventDetail('event-1'))).toBe(true);
  });
});
