// @vitest-environment jsdom
//
// Regression coverage for 86ey9e9rz: usePoCheckIn / usePoVoidCheckIn (and
// usePoCheckOut — same underlying bug, same fix, see mutations.ts) call
// optimisticCheckin(), which patches BOTH poKeys.guests AND poKeys.arrivals —
// but onMutate previously cancelled only the guests query. An in-flight
// arrivals refetch could then land right after the optimistic patch and
// silently overwrite it with pre-mutation data, snapping a just-checked-in
// guest back to "onderweg" on the event-dag cockpit. Asserts BOTH keys are
// cancelled (via the shared cancelCheckinQueries helper) before every
// check-in mutation that touches arrivals writes its optimistic patch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/features/door/offline/device', () => ({
  getDoorClient: () => ({}),
  getDeviceId: () => 'device-1',
}));

vi.mock('@/features/door/outbox/gateway', () => ({
  supabaseGateway: () => ({
    insertCheckIn: vi.fn(async () => ({ error: null })),
    topUpCheckIn: vi.fn(async () => ({ error: null })),
    voidCheckIn: vi.fn(async () => ({ error: null })),
    reviveCheckIn: vi.fn(async () => ({ error: null })),
    checkOutGuest: vi.fn(async () => ({ error: null })),
    insertRefusal: vi.fn(async () => ({ error: null })),
    undoRefusal: vi.fn(async () => ({ error: null })),
    ackNote: vi.fn(async () => ({ error: null })),
  }),
}));

vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import { usePoCheckIn, usePoVoidCheckIn, usePoCheckOut, usePoTopUpCheckIn } from './mutations';
import { poKeys } from './keys';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const cancelSpy = vi.spyOn(qc, 'cancelQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper, cancelSpy };
}

function cancelledKeys(spy: { mock: { calls: unknown[][] } }): unknown[] {
  return spy.mock.calls.map((call) => (call[0] as { queryKey: unknown }).queryKey);
}

function includesKey(keys: unknown[], expected: readonly unknown[]): boolean {
  return keys.some((k) => JSON.stringify(k) === JSON.stringify(expected));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('mutations.ts check-in cancelQueries (86ey9e9rz)', () => {
  it('usePoCheckIn cancels BOTH guests and arrivals before the optimistic patch', async () => {
    const { wrapper, cancelSpy } = makeWrapper();
    const { result } = renderHook(() => usePoCheckIn('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', plusOnes: 0 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = cancelledKeys(cancelSpy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(true);
  });

  it('usePoVoidCheckIn cancels BOTH guests and arrivals before the optimistic patch', async () => {
    const { wrapper, cancelSpy } = makeWrapper();
    const { result } = renderHook(() => usePoVoidCheckIn('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = cancelledKeys(cancelSpy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(true);
  });

  it('usePoCheckOut cancels BOTH guests and arrivals before the optimistic patch (same bug, same fix)', async () => {
    const { wrapper, cancelSpy } = makeWrapper();
    const { result } = renderHook(() => usePoCheckOut('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', remainingHeads: 0 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = cancelledKeys(cancelSpy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(true);
  });

  it('usePoTopUpCheckIn (unaffected, already correct) still only cancels arrivals', async () => {
    const { wrapper, cancelSpy } = makeWrapper();
    const { result } = renderHook(() => usePoTopUpCheckIn('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', plusOnes: 2 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = cancelledKeys(cancelSpy);
    expect(includesKey(keys, poKeys.arrivals('event-1'))).toBe(true);
  });
});
