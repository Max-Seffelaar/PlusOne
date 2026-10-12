// @vitest-environment jsdom
//
// Product analytics (PostHog PR 2): the mutation hooks capture ids, enums and
// counts in onSuccess — never the guest's name, e-mail, a note or a motivation
// that sit right there in the mutation input.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const A = vi.hoisted(() => ({ captured: [] as Record<string, unknown>[] }));
vi.mock('@/features/analytics/provider', () => ({
  analytics: { capture: (e: Record<string, unknown>) => A.captured.push(e) },
}));
vi.mock('@/features/guests/actions', () => ({
  addGuest: vi.fn(async () => ({ ok: true })),
  addGuestsBulk: vi.fn(async () => ({ ok: true })),
  removeGuest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/features/requests/actions', () => ({
  approveGuestRequest: vi.fn(async () => ({ ok: true })),
  decideGuestRequest: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/features/quotas/actions', () => ({ requestExtraSlots: vi.fn(async () => ({ ok: true })) }));
vi.mock('@/features/events/actions', () => ({
  createEvent: vi.fn(async () => ({ ok: true, eventId: 'ev-new' })),
  setListLock: vi.fn(async () => ({ ok: true })),
}));
vi.mock('@/features/auth/invite-actions', () => ({ inviteUserAction: vi.fn(async () => ({ ok: true })) }));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import {
  usePoAddGuest,
  usePoAddGuestsBulk,
  usePoRemoveGuest,
  usePoDecideRequest,
  usePoRequestExtraSlots,
  usePoCreateEvent,
  usePoSetListLock,
  usePoInviteUser,
} from './mutations';

const EV = '018f0000-0000-7000-8000-0000000000e1';
const TIER = '018f0000-0000-7000-8000-0000000000f1';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  A.captured.length = 0;
});

const PII = /Jan|Jansen|jan@|0612|too late|please|need more/i;

describe('mutation hooks capture product analytics without PII', () => {
  it('quick add → guest_added with method + plus_ones only', async () => {
    const { result } = renderHook(() => usePoAddGuest(EV), { wrapper });
    await act(() => result.current.mutateAsync({ eventId: EV, tierId: TIER, fullName: 'Jan Jansen', plusOnes: 2, email: 'jan@x.test', phone: '0612345678' }));
    expect(A.captured).toEqual([{ event: 'guest_added', event_id: EV, method: 'quick_add', plus_ones: 2 }]);
    expect(JSON.stringify(A.captured)).not.toMatch(PII);
  });

  it('bulk add → guests_added_bulk with the count', async () => {
    const { result } = renderHook(() => usePoAddGuestsBulk(EV), { wrapper });
    await act(() =>
      result.current.mutateAsync({ eventId: EV, guests: [{ tierId: TIER, fullName: 'Jan Jansen' }, { tierId: TIER, fullName: 'Piet' }] }),
    );
    expect(A.captured).toEqual([{ event: 'guests_added_bulk', event_id: EV, count: 2 }]);
  });

  it('remove → guest_removed, never the note to the guest', async () => {
    const { result } = renderHook(() => usePoRemoveGuest(EV), { wrapper });
    await act(() => result.current.mutateAsync({ guestId: 'g1', note: 'Sorry Jan, too late' }));
    expect(A.captured).toEqual([{ event: 'guest_removed', event_id: EV }]);
  });

  it('decide: somebody in = request_approved, nobody = request_denied; never the note', async () => {
    const { result } = renderHook(() => usePoDecideRequest(), { wrapper });
    await act(() => result.current.mutateAsync({ requestId: 'r1', eventId: EV, approved: [{ tierId: TIER, plusOnes: 1 }], declined: 1, note: 'please' }));
    await act(() => result.current.mutateAsync({ requestId: 'r2', eventId: EV, approved: [], declined: 2, note: 'too late' }));
    expect(A.captured).toEqual([
      { event: 'request_approved', event_id: EV },
      { event: 'request_denied', event_id: EV },
    ]);
  });

  it('extra slots → the amount, never the motivation', async () => {
    const { result } = renderHook(() => usePoRequestExtraSlots(EV), { wrapper });
    await act(() => result.current.mutateAsync({ eventId: EV, requestedExtra: 3, motivation: 'need more for Jan' }));
    expect(A.captured).toEqual([{ event: 'extra_slots_requested', event_id: EV, amount: 3 }]);
  });

  it('create event → event_created with the new id', async () => {
    const { result } = renderHook(() => usePoCreateEvent(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    expect(A.captured).toEqual([{ event: 'event_created', event_id: 'ev-new', from_template: false }]);
  });

  it('list lock → list_lock_toggled', async () => {
    const { result } = renderHook(() => usePoSetListLock(EV), { wrapper });
    await act(() => result.current.mutateAsync({ eventId: EV, locked: true }));
    expect(A.captured).toEqual([{ event: 'list_lock_toggled', event_id: EV, locked: true }]);
  });

  it('invite → roles + event count, never the address', async () => {
    const { result } = renderHook(() => usePoInviteUser(), { wrapper });
    await act(() => result.current.mutateAsync({ email: 'jan@x.test', roles: ['staff'], eventIds: ['a', 'b'] }));
    expect(A.captured).toEqual([{ event: 'member_invited', roles_granted: ['staff'], event_count: 2 }]);
    expect(JSON.stringify(A.captured)).not.toMatch(PII);
  });

  it('a failed mutation captures nothing', async () => {
    const { addGuest } = await import('@/features/guests/actions');
    vi.mocked(addGuest).mockResolvedValueOnce({ ok: false, message: 'nope' } as never);
    const { result } = renderHook(() => usePoAddGuest(EV), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ eventId: EV, tierId: TIER, fullName: 'Jan' }).catch(() => undefined);
    });
    expect(A.captured).toEqual([]);
  });
});
