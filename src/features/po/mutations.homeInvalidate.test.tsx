// @vitest-environment jsdom
//
// Regression coverage for 86ey9e9v5: poKeys.home (Mobile Dashboard-home board —
// its own fetch + its own 10s poll, see usePoHomeEvents) is a SEPARATE cache
// entry from poKeys.events. Every event mutation invalidated poKeys.events
// (so the Events tab updated immediately) but not poKeys.home — the Home board
// only caught up on its next poll tick, so Home and Events could visibly
// disagree right after a create/cancel/status change. PR #228 fixed this ad
// hoc for the lock toggle only (usePoSetListLockOnHome); useInvalidateEvent
// now invalidates poKeys.home for every one of its callers, and the two
// create-event mutations (which don't go through useInvalidateEvent) do the
// same directly. Asserts a representative sample of each family.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('@/features/events/actions', () => ({
  createEvent: vi.fn(async () => ({ ok: true, eventId: 'event-new' })),
  createTier: vi.fn(),
  deleteTier: vi.fn(),
  setAutoLock: vi.fn(),
  setEventAllowUncheck: vi.fn(),
  setEventCancelled: vi.fn(async () => ({ ok: true })),
  setLandingActive: vi.fn(),
  setListLock: vi.fn(),
  updateEvent: vi.fn(async () => ({ ok: true })),
  updateTier: vi.fn(),
  createTemplate: vi.fn(),
  updateTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  createTemplateTier: vi.fn(),
  updateTemplateTier: vi.fn(),
  deleteTemplateTier: vi.fn(),
  createEventFromTemplate: vi.fn(async () => ({ ok: true, eventId: 'event-from-template' })),
  createTemplateFromEvent: vi.fn(),
  assignOrganizer: vi.fn(),
  inviteExternalCrew: vi.fn(),
  removeOrganizer: vi.fn(),
  resendCrewInvite: vi.fn(),
  setEventUserQuota: vi.fn(),
  setEventDefaultMemberQuota: vi.fn(),
}));

vi.mock('./PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'venue-1', userId: 'user-1', roles: ['admin'] }),
}));

import {
  usePoUpdateEvent,
  usePoSetCancelled,
  usePoCreateEvent,
  usePoCreateEventFromTemplate,
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

describe('event mutations also invalidate poKeys.home (86ey9e9v5)', () => {
  it('usePoUpdateEvent (via useInvalidateEvent) invalidates both events and home', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoUpdateEvent('event-1'), { wrapper });

    act(() => result.current.mutate({ eventId: 'event-1', name: 'New name' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.events('venue-1'))).toBe(true);
    expect(includesKey(keys, poKeys.home('venue-1'))).toBe(true);
  });

  it('usePoSetCancelled (via useInvalidateEvent) invalidates home', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoSetCancelled('event-1'), { wrapper });

    act(() => result.current.mutate({ eventId: 'event-1', cancelled: true }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.home('venue-1'))).toBe(true);
  });

  it('usePoCreateEvent invalidates home', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoCreateEvent(), { wrapper });

    act(() => result.current.mutate({ venueId: 'venue-1', name: 'New event', startsAt: '2026-08-10T20:00:00Z' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.home('venue-1'))).toBe(true);
  });

  it('usePoCreateEventFromTemplate invalidates home', async () => {
    const { wrapper, spy } = makeWrapper();
    const { result } = renderHook(() => usePoCreateEventFromTemplate(), { wrapper });

    act(() =>
      result.current.mutate({ templateId: 't1', name: 'From template', startsAt: '2026-08-10T20:00:00Z' })
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = invalidatedKeys(spy);
    expect(includesKey(keys, poKeys.home('venue-1'))).toBe(true);
  });
});
