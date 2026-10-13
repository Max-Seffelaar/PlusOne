// @vitest-environment jsdom
//
// Snelheid P2 (P1-review follow-up): usePoEvents keeps the venue's event window
// fresh for minutes instead of 30 s. That is only safe because every write that
// moves a card's on-list / inside count invalidates the ['po','events'] prefix
// (the window, Home's select over it, and the single-event reads under it).
// A sample of each family: add, edit/remove (guestMutation), approve.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/features/guests/actions', () => ({
  addGuest: vi.fn(async () => ({ ok: true })),
  addGuestsBulk: vi.fn(async () => ({ ok: true })),
  removeGuest: vi.fn(async () => ({ ok: true })),
  updateGuest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/features/requests/actions', () => ({
  approveGuestRequest: vi.fn(async () => ({ ok: true })),
  decideGuestRequest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import { usePoAddGuest, usePoRemoveGuest, usePoUpdateGuest, usePoApproveRequest, EVENTS_PREFIX } from './mutations';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { wrapper, spy };
}

const invalidatedEvents = (spy: { mock: { calls: unknown[][] } }): boolean =>
  spy.mock.calls.some((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey) === JSON.stringify(EVENTS_PREFIX));

afterEach(() => {
  vi.clearAllMocks();
});

describe('guest writes invalidate the event window (staleTime minutes is safe)', () => {
  it('EVENTS_PREFIX is the prefix of the events window key', () => {
    expect(EVENTS_PREFIX).toEqual(['po', 'events']);
  });

  it('usePoAddGuest', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoAddGuest('event-1'), { wrapper });
    act(() => result.current.mutate({ id: 'g1', eventId: 'event-1', tierId: null, fullName: 'A', plusOnes: 1 } as never));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedEvents(spy)).toBe(true);
  });

  it('usePoUpdateGuest', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoUpdateGuest('event-1'), { wrapper });
    act(() => result.current.mutate({ guestId: 'g1', plusOnes: 2 } as never));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedEvents(spy)).toBe(true);
  });

  it('usePoRemoveGuest', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoRemoveGuest('event-1'), { wrapper });
    act(() => result.current.mutate('g1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedEvents(spy)).toBe(true);
  });

  it('usePoApproveRequest', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoApproveRequest(), { wrapper });
    act(() => result.current.mutate({ requestId: 'r1', eventId: 'event-1' } as never));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidatedEvents(spy)).toBe(true);
  });
});
