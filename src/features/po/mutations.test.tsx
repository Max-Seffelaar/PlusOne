// @vitest-environment jsdom
//
// Regression coverage for the 2026-07 review's P3 cache-invalidation findings
// (C16/C17/C18/G2, ClickUp 86ey6xdkb): each fixed hook must invalidate the key
// it was previously missing, alongside whatever it already invalidated. These
// assert the onSuccess key-lists directly rather than the underlying UI effect,
// mirroring the existing invariant documented at mutations.ts:168 ("every guest
// mutation must invalidate venue-guests too").
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/features/guests/actions', () => ({
  addGuest: vi.fn(),
  addGuestsBulk: vi.fn(),
  updateGuest: vi.fn(async () => ({ ok: true })),
  changeGuestTier: vi.fn(async () => ({ ok: true })),
  changeGuestsTierBulk: vi.fn(async () => ({ ok: true })),
  removeGuest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/features/requests/actions', () => ({
  approveGuestRequest: vi.fn(async () => ({ ok: true })),
  denyGuestRequest: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@/features/contacts/actions', () => ({
  importContacts: vi.fn(),
  addContactToEvent: vi.fn(),
  addContactsToEvent: vi.fn(),
  toggleContactPermanent: vi.fn(),
  upsertContact: vi.fn(),
  forgetContact: vi.fn(async () => ({ ok: true })),
  promoteGuestToContact: vi.fn(),
  markGuestRegular: vi.fn(),
}));

vi.mock('@/features/links/actions', () => ({
  createInfluencer: vi.fn(),
  updateInfluencer: vi.fn(async () => ({ ok: true })),
  createRequestLink: vi.fn(),
  updateRequestLink: vi.fn(),
  rotateInfluencerStatsToken: vi.fn(),
  revokeInfluencerStatsToken: vi.fn(),
}));

vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import { addGuest } from '@/features/guests/actions';
import { updateRequestLink } from '@/features/links/actions';
import {
  usePoUpdateGuest,
  usePoRemoveGuest,
  usePoApproveRequest,
  usePoForgetContact,
  usePoUpdateInfluencer,
  usePoUpdateLink,
  usePoBulkAddToEvent,
  VENUE_GUESTS_PREFIX,
} from './mutations';
import { poKeys } from './keys';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
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
});

describe('mutations.ts cache invalidation (2026-07 review P3, 86ey6xdkb)', () => {
  it('usePoUpdateGuest invalidates guests + quota + venue-guests (C16)', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoUpdateGuest('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', fullName: 'Test' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.quota('event-1'))).toBe(true);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
  });

  it('usePoRemoveGuest invalidates guests + quota + venue-guests (C16)', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoRemoveGuest('event-1'), { wrapper });

    act(() => result.current.mutate('g1'));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.quota('event-1'))).toBe(true);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
  });

  it('usePoApproveRequest invalidates venue-guests when an eventId is present (C17)', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoApproveRequest(), { wrapper });

    act(() => result.current.mutate({ requestId: 'r1', tierId: 't1', eventId: 'event-1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-1'))).toBe(true);
    expect(includesKey(keys, poKeys.tiers('event-1'))).toBe(true);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
  });

  it('usePoForgetContact invalidates venue-guests, not just the per-event guests prefix (C18)', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoForgetContact(), { wrapper });

    act(() => result.current.mutate({ contactId: 'c1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
  });

  it('usePoUpdateInfluencer invalidates the Promotion dashboard funnel/leaderboard prefixes (G2)', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoUpdateInfluencer(), { wrapper });

    act(() => result.current.mutate({ influencerId: 'i1', name: 'New Name' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, [...poKeys.all, 'link-funnel'])).toBe(true);
    expect(includesKey(keys, [...poKeys.all, 'promo'])).toBe(true);
    // Existing behavior must be unregressed too.
    expect(includesKey(keys, [...poKeys.all, 'influencers'])).toBe(true);
  });
});

describe('usePoUpdateLink optimistic pause/resume (86ey9e9v5)', () => {
  it('flips the cached link immediately and keeps the flip on success', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    qc.setQueryData(poKeys.requestLinks('event-1'), [{ id: 'link-1', active: true }]);
    vi.mocked(updateRequestLink).mockResolvedValueOnce({ ok: true });

    const { result } = renderHook(() => usePoUpdateLink('event-1'), { wrapper: Wrapper });
    act(() => result.current.mutate({ linkId: 'link-1', active: false }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cached = qc.getQueryData<{ id: string; active: boolean }[]>(poKeys.requestLinks('event-1'));
    expect(cached?.find((l) => l.id === 'link-1')?.active).toBe(false);
  });

  it('rolls back the optimistic flip when the write fails (86ey9e9v5 — pause toggle previously had no rollback path via cancelQueries)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const Wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    qc.setQueryData(poKeys.requestLinks('event-1'), [{ id: 'link-1', active: true }]);
    vi.mocked(updateRequestLink).mockResolvedValueOnce({ ok: false, code: 'error', message: 'nope' });

    const { result } = renderHook(() => usePoUpdateLink('event-1'), { wrapper: Wrapper });
    act(() => result.current.mutate({ linkId: 'link-1', active: false }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    const cached = qc.getQueryData<{ id: string; active: boolean }[]>(poKeys.requestLinks('event-1'));
    expect(cached?.find((l) => l.id === 'link-1')?.active).toBe(true);
  });
});

describe('usePoBulkAddToEvent invalidates on error too (86ey9e9v5 — onSettled, not onSuccess)', () => {
  it('still invalidates the target event caches when a row throws mid-loop', async () => {
    const { wrapper, spy } = makeWrapper();
    vi.mocked(addGuest).mockRejectedValueOnce(new Error('boom'));

    const { result } = renderHook(() => usePoBulkAddToEvent(), { wrapper });
    act(() =>
      result.current.mutate({
        targetEventId: 'event-2',
        tierId: 'tier-1',
        targetLocked: false,
        people: [{ key: 'p1', name: 'Guest One', contactId: null, plusOnes: 0, alreadyOn: false }],
      })
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.guests('event-2'))).toBe(true);
    expect(includesKey(keys, poKeys.quota('event-2'))).toBe(true);
    expect(includesKey(keys, VENUE_GUESTS_PREFIX)).toBe(true);
  });
});
