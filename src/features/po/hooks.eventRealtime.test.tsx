// @vitest-environment jsdom
//
// Regression coverage for usePoEventRealtime, the desktop cockpit's live feed.
//
// C19 (2026-07 review P3, ClickUp 86ey6xdkb): a peer's check-in/void must also
// refresh the event-detail header (eventDetail).
// 86ey9e8hz: the venue-wide All-Guests tab (VENUE_GUESTS_PREFIX) is NOT
// re-downloaded per check-in; it refreshes on guest WRITES (mutation paths).
// 86ey9e8fe: a burst collapses (leading + trailing), never one cascade per event.
// Snelheid P2 (finding 10): the guest list and the arrivals are PATCHED from the
// payload (no request for an ordinary check-in/void/edit); only a row the payload
// can't build (a peer's new guest, an unknown tier) refetches the list, and the
// server aggregates (tiers, stats, event detail) refresh at most every ~5 s.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

type Payload = { new: Record<string, unknown> };
interface FakeChannel {
  on: (event: string, filter: { table: string }, cb: (p: Payload) => void) => FakeChannel;
  subscribe: (cb: (status: string) => void) => FakeChannel;
}

const handlers: Record<string, (p: Payload) => void> = {};
let statusCb: ((status: string) => void) | null = null;
const channelChain: FakeChannel = {
  on: vi.fn((_event: string, filter: { table: string }, cb: (p: Payload) => void) => {
    handlers[filter.table] = cb;
    return channelChain;
  }),
  subscribe: vi.fn((cb: (status: string) => void) => {
    // First-ever SUBSCRIBED must NOT itself trigger an invalidate (that would
    // double-fetch on mount) — mirrors src/features/door/sync/reconnect.ts.
    statusCb = cb;
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

import type { Guest, Tier } from '@/lib/po/types';
import type { CheckinArrival } from './queries';

const GUEST = (id: string, over: Partial<Guest> = {}): Guest =>
  ({ id, name: id, role: 'Guest', tierId: 't1', tierName: 'Regular', tierColor: '#888', plus: 0, note: '', flag: null, status: 'wait', ...over }) as Guest;
const TIERS = [
  { id: 't1', name: 'Regular', color: '#888' },
  { id: 't2', name: 'VIP', color: '#B5A6FF' },
] as Tier[];

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(poKeys.guests('event-1'), [GUEST('g1'), GUEST('g2')]);
  qc.setQueryData(poKeys.tiers('event-1'), TIERS);
  qc.setQueryData(poKeys.arrivals('event-1'), new Map<string, CheckinArrival>());
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper, spy };
}

function invalidatedKeys(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

function includesKey(keys: unknown[], expected: readonly unknown[]): boolean {
  return keys.some((k) => JSON.stringify(k) === JSON.stringify(expected));
}

afterEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(handlers)) delete handlers[k];
  statusCb = null;
});

const checkIn = (guestId: string, voided = false): Payload => ({
  new: { id: `ci-${guestId}`, guest_id: guestId, plus_ones_arrived: 1, checked_at: '2026-10-12T22:00:00Z', voided_at: voided ? '2026-10-12T22:05:00Z' : null },
});

async function mount() {
  const ctx = makeWrapper();
  const { result } = renderHook(() => usePoEventRealtime('event-1'), { wrapper: ctx.wrapper });
  await waitFor(() => expect(result.current.realtimeConnected).toBe(true));
  expect(Object.keys(handlers).sort()).toEqual(['check_ins', 'guests']);
  ctx.spy.mockClear();
  return ctx;
}

describe('usePoEventRealtime — patch from the payload (Snelheid P2 #10)', () => {
  it('a peer check-in patches the guest and the arrivals in place: no list refetch, aggregates refresh (C19), venue-guests untouched', async () => {
    const { qc, spy } = await mount();
    act(() => {
      handlers.guests({ new: { id: 'g1', status: 'checked_in', plus_ones: 1 } });
      handlers.check_ins(checkIn('g1'));
    });

    expect(qc.getQueryData<Guest[]>(poKeys.guests('event-1'))?.find((g) => g.id === 'g1')).toMatchObject({ status: 'in', plus: 1 });
    expect(qc.getQueryData<Map<string, CheckinArrival>>(poKeys.arrivals('event-1'))?.get('g1')).toEqual({
      arrived: 1, at: '2026-10-12T22:00:00Z', id: 'ci-g1',
    });
    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(false);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(false);
    expect(includesKey(keys, poKeys.tiers('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.eventStats('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.eventDetail('event-1'))).toBe(true);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(false);
  });

  it('a void clears the arrival; a removal drops the guest; a tier move takes the known tier', async () => {
    const { qc } = await mount();
    act(() => handlers.check_ins(checkIn('g1')));
    act(() => handlers.check_ins(checkIn('g1', true)));
    expect(qc.getQueryData<Map<string, CheckinArrival>>(poKeys.arrivals('event-1'))?.has('g1')).toBe(false);

    act(() => handlers.guests({ new: { id: 'g2', status: 'removed' } }));
    expect(qc.getQueryData<Guest[]>(poKeys.guests('event-1'))?.map((g) => g.id)).toEqual(['g1']);

    act(() => handlers.guests({ new: { id: 'g1', status: 'approved', tier_id: 't2' } }));
    expect(qc.getQueryData<Guest[]>(poKeys.guests('event-1'))?.[0]).toMatchObject({ tierId: 't2', tierName: 'VIP', role: 'VIP' });
  });

  it('a row the payload cannot build (a peer\'s new guest, an unknown tier) refetches the list', async () => {
    const { spy } = await mount();
    vi.useFakeTimers();
    try {
      act(() => handlers.guests({ new: { id: 'g-new', status: 'approved', full_name: 'New' } }));
      expect(includesKey(invalidatedKeys(spy), poKeys.guests('event-1'))).toBe(true);
      // Past the 500 ms list-refetch window, so the next one fires on its leading edge.
      act(() => vi.advanceTimersByTime(600));
      spy.mockClear();
      act(() => handlers.guests({ new: { id: 'g1', status: 'approved', tier_id: 't-unknown' } }));
      expect(includesKey(invalidatedKeys(spy), poKeys.guests('event-1'))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a resubscribe after a drop refetches everything (#0b)', async () => {
    const { spy } = await mount();
    act(() => statusCb?.('CHANNEL_ERROR'));
    act(() => statusCb?.('SUBSCRIBED'));
    const keys = invalidatedKeys(spy);
    for (const k of [poKeys.guests('event-1'), poKeys.arrivals('event-1'), poKeys.tiers('event-1'), poKeys.eventStats('event-1')]) {
      expect(includesKey(keys, k)).toBe(true);
    }
  });
});

describe('usePoEventRealtime throttling (86ey9e8fe → ~5 s for aggregates)', () => {
  it('a door-rush burst refreshes the 3 aggregates once now and once per 5 s, never per event, with zero list refetches', async () => {
    const { spy } = await mount();
    vi.useFakeTimers();
    try {
      // 8 check-ins, each touching guests AND check_ins (16 events).
      act(() => {
        for (let i = 0; i < 8; i++) {
          handlers.guests({ new: { id: i % 2 ? 'g1' : 'g2', status: 'checked_in' } });
          handlers.check_ins(checkIn(i % 2 ? 'g1' : 'g2'));
        }
      });
      expect(spy.mock.calls.length).toBe(3); // leading edge: tiers, stats, event detail

      act(() => vi.advanceTimersByTime(600));
      expect(spy.mock.calls.length).toBe(3); // not yet: aggregates wait ~5 s

      act(() => vi.advanceTimersByTime(4_500));
      expect(spy.mock.calls.length).toBe(6); // one trailing refresh for the whole burst
      expect(includesKey(invalidatedKeys(spy), poKeys.guests('event-1'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
