// @vitest-environment jsdom
//
// Snelheid P2, finding 14:
// - adding a guest swaps the optimistic row for the ONE server row (single-row
//   read) instead of re-downloading the event's whole list; a failed read falls
//   back to the refetch;
// - usePoGuests takes tier names from the event's tiers query when it is fresh,
//   instead of reading guest_tiers a second time.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Guest, Tier } from '@/lib/po/types';

const H = vi.hoisted(() => ({
  rowCalls: [] as unknown[],
  row: null as Record<string, unknown> | null,
  tiersFetches: 0,
  gate: null as Promise<void> | null,
}));

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/features/guests/actions', () => ({
  addGuest: vi.fn(async () => ({ ok: true })),
  addGuestsBulk: vi.fn(),
  removeGuest: vi.fn(),
  updateGuest: vi.fn(),
  changeGuestTier: vi.fn(),
  changeGuestsTierBulk: vi.fn(),
}));
vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'v1', userId: 'u1', roles: ['admin'] }),
}));
vi.mock('./queries', async (orig) => {
  const actual = await orig<typeof import('./queries')>();
  return {
    ...actual,
    fetchGuests: vi.fn(async (_c: unknown, _e: string, opts?: { guestId?: string }) => {
      H.rowCalls.push(opts ?? null);
      if (opts?.guestId && H.gate) await H.gate;
      return opts?.guestId ? (H.row ? [H.row] : []) : [];
    }),
    fetchTiersWithUsage: vi.fn(async () => {
      H.tiersFetches += 1;
      return [];
    }),
  };
});

import { usePoAddGuest } from './mutations';
import { usePoGuests } from './hooks';
import { poKeys } from './keys';

const TIERS = [{ id: 't1', name: 'VIP', color: '#B5A6FF', role: 'VIP' }] as Tier[];
const NEW_ID = '01900000-0000-7000-8000-000000000001';

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  qc.setQueryData(poKeys.tiers('e1'), TIERS);
  qc.setQueryData(poKeys.guests('e1'), [{ id: 'old', name: 'Old' } as Guest]);
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, spy, wrapper };
}
const invalidated = (spy: { mock: { calls: unknown[][] } }, key: readonly unknown[]): boolean =>
  spy.mock.calls.some((c) => JSON.stringify((c[0] as { queryKey: unknown }).queryKey) === JSON.stringify(key));

afterEach(() => {
  vi.clearAllMocks();
  H.rowCalls = [];
  H.row = null;
  H.tiersFetches = 0;
  H.gate = null;
});

const NINA_ROW = {
  id: NEW_ID, full_name: 'Nina', plus_ones: 1, status: 'approved', tier_id: 't1', note: null, note_priority: 'none',
  note_acknowledged_at: null, created_at: '2026-10-12T20:00:00Z', contact_id: null, anonymized_at: null, event_id: 'e1',
  source: 'app', addedByName: 'Max', addedByKind: 'member', linkLabel: null,
};

describe('usePoAddGuest — patch the one new row', () => {
  it('reads only the new row and puts it first, without re-downloading the list', async () => {
    H.row = NINA_ROW;
    const { qc, spy, wrapper } = setup();
    const { result } = renderHook(() => usePoAddGuest('e1'), { wrapper });
    act(() => result.current.mutate({ id: NEW_ID, eventId: 'e1', tierId: 't1', fullName: 'Nina', plusOnes: 1 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    await waitFor(() => expect(qc.getQueryData<Guest[]>(poKeys.guests('e1'))?.[0]?.addedByName).toBe('Max'));

    expect(H.rowCalls).toEqual([{ guestId: NEW_ID }]);
    const list = qc.getQueryData<Guest[]>(poKeys.guests('e1')) ?? [];
    expect(list.map((g) => g.id)).toEqual([NEW_ID, 'old']);
    expect(list[0]).toMatchObject({ name: 'Nina', plus: 1, tierName: 'VIP', role: 'VIP' });
    expect(invalidated(spy, poKeys.guests('e1'))).toBe(false);
    expect(invalidated(spy, poKeys.tiers('e1'))).toBe(true);
    expect(invalidated(spy, poKeys.quota('e1'))).toBe(true);
    // Review #493: the stats panel's "added by" / per-tier counts move too.
    expect(invalidated(spy, poKeys.eventStats('e1'))).toBe(true);
  });

  it('review #493: an empty list cache is refetched, never stored as a one-row list', async () => {
    H.row = NINA_ROW;
    const { qc, spy, wrapper } = setup();
    qc.removeQueries({ queryKey: poKeys.guests('e1') });
    const { result } = renderHook(() => usePoAddGuest('e1'), { wrapper });
    act(() => result.current.mutate({ id: NEW_ID, eventId: 'e1', tierId: 't1', fullName: 'Nina', plusOnes: 1 }));
    await waitFor(() => expect(invalidated(spy, poKeys.guests('e1'))).toBe(true));
    expect(H.rowCalls).toEqual([]);
  });

  it('review #493: a list read in flight wins: no patch, a refetch instead', async () => {
    H.row = NINA_ROW;
    const { qc, spy, wrapper } = setup();
    let release!: () => void;
    H.gate = new Promise<void>((r) => (release = r));
    const { result } = renderHook(() => usePoAddGuest('e1'), { wrapper });
    act(() => result.current.mutate({ id: NEW_ID, eventId: 'e1', tierId: 't1', fullName: 'Nina', plusOnes: 1 }));
    await waitFor(() => expect(H.rowCalls).toEqual([{ guestId: NEW_ID }]));
    // A list refetch (safety poll, realtime) starts while the row read is out.
    void qc.fetchQuery({ queryKey: poKeys.guests('e1'), queryFn: () => new Promise<Guest[]>(() => {}) });
    release();
    await waitFor(() => expect(invalidated(spy, poKeys.guests('e1'))).toBe(true));
    expect(qc.getQueryData<Guest[]>(poKeys.guests('e1'))?.some((g) => g.addedByName === 'Max')).toBe(false);
  });

  it('review #493: the mutation succeeds without waiting for the patch read', async () => {
    H.row = NINA_ROW;
    H.gate = new Promise<void>(() => {}); // the row read never answers
    const { wrapper } = setup();
    const { result } = renderHook(() => usePoAddGuest('e1'), { wrapper });
    act(() => result.current.mutate({ id: NEW_ID, eventId: 'e1', tierId: 't1', fullName: 'Nina', plusOnes: 1 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });

  it('falls back to the list refetch when the row cannot be read', async () => {
    H.row = null;
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => usePoAddGuest('e1'), { wrapper });
    act(() => result.current.mutate({ id: NEW_ID, eventId: 'e1', tierId: 't1', fullName: 'Nina', plusOnes: 0 }));
    await waitFor(() => expect(invalidated(spy, poKeys.guests('e1'))).toBe(true));
  });
});

describe('usePoGuests — tier names from the tiers query', () => {
  it('reuses a fresh tiers cache instead of reading guest_tiers again', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(poKeys.tiers('e1'), TIERS);
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => usePoGuests('e1'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(H.tiersFetches).toBe(0);
  });
});
