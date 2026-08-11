// @vitest-environment jsdom
//
// #34 — a partial check-out must be ATOMIC (86ey9e9q2).
//
// The cockpit's ✗ modal can leave part of a party inside ("3 of the 4 leave").
// check_ins keeps ONE row per guest with a monotone plus_ones_arrived, so the
// pre-fix implementation modelled that as two round trips: void the row, then
// revive it with the smaller count. A transient failure BETWEEN them (network
// flap, 502 from the edge) leaves the guest fully checked out — headcount −4
// instead of −2 — with no way for the cockpit to know it only got halfway.
//
// These tests run the hook against a fake gateway backed by an in-memory
// check_ins row, so they assert the resulting DATABASE state (CLAUDE.md DoD #4),
// not an `ok: true`. The failing-leg test is the finder's scenario; it fails
// against the void-then-revive implementation and passes once the whole
// check-out is one `check_out_guest` RPC call.
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { DbError, DoorGateway } from '@/features/door/outbox/gateway';

// mutations.ts re-exports the billing checkout actions, which pull in the Stripe
// SDK. The door/cockpit write path has nothing to do with billing, so stub the
// action module rather than dragging the SDK into a jsdom unit test.
vi.mock('@/features/billing/actions', () => ({
  createCheckoutSessionAction: vi.fn(),
  createPortalSessionAction: vi.fn(),
}));

vi.mock('@/features/door/offline/device', () => ({
  getDoorClient: () => ({}) as never,
  getDeviceId: () => 'door-test-01',
}));

vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

/** The single check_ins row for our guest, as the database would hold it. */
interface Row {
  id: string;
  checked_by: string;
  plus_ones_arrived: number;
  voided_at: string | null;
}

const NETWORK: DbError = { code: undefined, message: 'Failed to fetch' };

let row: Row;
/** Gateway calls that must fail, by method name — simulates a mid-flight flap. */
let failing: Set<string>;

/**
 * A gateway with the REAL server-side semantics of each write (the filters the
 * PostgREST calls apply + the revive-aware cap trigger), so a test failure means
 * the write sequence is wrong, not that a mock drifted.
 */
const fakeGateway: DoorGateway = {
  insertCheckIn: async () => ({ error: null }),
  topUpCheckIn: async () => ({ error: null }),
  insertRefusal: async () => ({ error: null }),
  undoRefusal: async () => ({ error: null }),
  insertGuest: async () => ({ error: null }),
  ackNote: async () => ({ error: null }),
  voidCheckIn: async () => {
    if (failing.has('voidCheckIn')) return { error: NETWORK };
    if (row.voided_at == null) row = { ...row, voided_at: '2026-08-10T22:10:00.000Z' };
    return { error: null };
  },
  reviveCheckIn: async (_guestId, plusOnesArrived, uid) => {
    if (failing.has('reviveCheckIn')) return { error: NETWORK };
    if (row.voided_at != null) row = { ...row, voided_at: null, checked_by: uid, plus_ones_arrived: plusOnesArrived };
    return { error: null };
  },
  checkOutGuest: async (_guestId, remainingHeads) => {
    if (failing.has('checkOutGuest')) return { error: NETWORK };
    // One transaction: either the whole check-out lands or nothing does.
    row =
      remainingHeads <= 0
        ? { ...row, voided_at: '2026-08-10T22:10:00.000Z' }
        : { ...row, voided_at: null, plus_ones_arrived: remainingHeads - 1 };
    return { error: null };
  },
};

vi.mock('@/features/door/outbox/gateway', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/door/outbox/gateway')>()),
  supabaseGateway: () => fakeGateway,
}));

import { usePoCheckOut } from './mutations';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { wrapper };
}

beforeEach(() => {
  // Guest with +3: checked in by a peer, whole party of 4 inside.
  row = { id: 'ci-1', checked_by: 'peer-user', plus_ones_arrived: 3, voided_at: null };
  failing = new Set();
});

describe('usePoCheckOut — partial check-out is atomic (#34, 86ey9e9q2)', () => {
  it('leaves the guest fully inside when the check-out fails mid-flight', async () => {
    // The finder's scenario: the write that lowers the party fails transiently.
    failing = new Set(['reviveCheckIn', 'checkOutGuest']);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePoCheckOut('event-1'), { wrapper });

    // 4 heads inside, 2 leave → 2 stay.
    act(() => result.current.mutate({ guestId: 'g1', remainingHeads: 2, checkInId: 'ci-1' }));
    await waitFor(() => expect(result.current.isError).toBe(true));

    // A failed check-out must not have half-applied: the guest is still inside
    // with the party they arrived with, so the door sees the truth and retries.
    expect(row.voided_at).toBeNull();
    expect(row.plus_ones_arrived).toBe(3);
  });

  it('lowers the party in one write when it succeeds (2 of 4 stay inside)', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePoCheckOut('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', remainingHeads: 2, checkInId: 'ci-1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(row.voided_at).toBeNull();
    expect(row.plus_ones_arrived).toBe(1); // 2 heads = guest + 1
    // The guest never left, so the first-wins arrival identity stays put (C10).
    expect(row.checked_by).toBe('peer-user');
  });

  it('fully checks out when nobody stays (remainingHeads 0)', async () => {
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => usePoCheckOut('event-1'), { wrapper });

    act(() => result.current.mutate({ guestId: 'g1', remainingHeads: 0, checkInId: 'ci-1' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(row.voided_at).not.toBeNull();
  });
});
