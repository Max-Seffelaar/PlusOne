// @vitest-environment jsdom
/**
 * Wiring cover for the desktop cockpit's stale-resume guard (86eykg2x1).
 *
 * The pure freshness math and the sync adapter are tested next door
 * (`cockpitFreshness.test.ts`, `useCockpitSync.test.tsx`) and the state machine
 * itself in `features/door/sync/useStaleResumeGuard.test.ts`. What no other test
 * can prove is the thing PR #252 got wrong: that this surface is ACTUALLY
 * connected. So this mounts the real `EventDayCockpitGate` — real guard, real
 * overlay — and only fakes the data layer underneath.
 *
 * Deliberately heavy on mocks: the cockpit has a wide hook surface, and every
 * mock below is pinned to the minimum this behaviour needs (same approach as
 * `components/po/app.auto-open.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  type Snap = { dataUpdatedAt: number; fetchStatus: 'fetching' | 'paused' | 'idle' };
  let snapshot: Snap = { dataUpdatedAt: 0, fetchStatus: 'idle' };
  const refetched: Record<string, number> = {};
  return {
    refetched,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get: (): Snap => snapshot,
    set: (next: Partial<Snap>): void => {
      snapshot = { ...snapshot, ...next };
      listeners.forEach((cb) => cb());
    },
    reset: (): void => {
      snapshot = { dataUpdatedAt: 0, fetchStatus: 'idle' };
      for (const k of Object.keys(refetched)) delete refetched[k];
    },
  };
});

/** A query result whose freshness the test drives, wired through
 *  useSyncExternalStore so changing it actually re-renders the cockpit. Named as
 *  a hook because that is what it is — it is called from the mocked hooks below,
 *  which are themselves only ever called during render. */
function useTrackedQuery<T>(key: string, data: T) {
  const snap = useSyncExternalStore(H.subscribe, H.get, H.get);
  return {
    data,
    isLoading: false,
    isSuccess: true,
    dataUpdatedAt: snap.dataUpdatedAt,
    fetchStatus: snap.fetchStatus,
    refetch: () => {
      H.refetched[key] = (H.refetched[key] ?? 0) + 1;
      return Promise.resolve({});
    },
  };
}

const EVENT = { id: 'ev1', name: 'Testnacht', phase: 'live', startsAt: null };

vi.mock('@/features/po/hooks', () => ({
  usePoDoorCandidates: () => ({ data: [EVENT], isLoading: false, isSuccess: true }),
  usePoGuests: () => useTrackedQuery('guests', []),
  usePoTiers: () => useTrackedQuery('tiers', []),
  usePoEventStats: () => useTrackedQuery('stats', undefined),
  usePoCheckinArrivals: () => useTrackedQuery('arrivals', new Map()),
  usePoEventForEdit: () => ({
    ...useTrackedQuery('event', { listLocked: false, allowUncheck: true, startsAt: null, isOrganizer: true }),
    isAdmin: true,
    canManage: true,
  }),
  usePoGuestRequests: () => useTrackedQuery('guestRequests', []),
  usePoQuotaRequests: () => useTrackedQuery('quotaRequests', []),
  usePoEventRealtime: () => ({ realtimeConnected: true }),
}));

const noopMutation = () => ({ mutate: vi.fn(), isPending: false });
vi.mock('@/features/po/mutations', () => ({
  usePoAckNote: noopMutation,
  usePoApproveRequest: noopMutation,
  usePoCheckIn: noopMutation,
  usePoCheckOut: noopMutation,
  usePoDecideQuota: noopMutation,
  usePoDenyRequest: noopMutation,
  usePoRefuseGuest: noopMutation,
  usePoSetListLock: noopMutation,
  usePoTopUpCheckIn: noopMutation,
  usePoUndoRefusal: noopMutation,
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: 'v1', venueName: 'Venue', roles: ['admin'] }),
}));
vi.mock('@/components/po/context', () => ({
  useNav: () => ({ push: vi.fn(), setTab: vi.fn(), openDoor: vi.fn() }),
}));
vi.mock('@/components/po/screens/door', () => ({ DoorEventPicker: () => null }));

const { EventDayCockpitGate } = await import('./EventDayCockpit');

const NOW = 1_700_000_000_000;
const STALE = 6 * 60_000; // past the guard's 5 min default
const BACKSTOP_MS = 8_000; // useStaleResumeGuard's DEFAULT_SYNC_WAIT_TIMEOUT_MS

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** hidden → visible: the only transition the guard treats as a resume. */
function resume(): void {
  act(() => setVisibility('hidden'));
  act(() => setVisibility('visible'));
}

function renderCockpit() {
  return render(<EventDayCockpitGate chosenId="ev1" onChoose={vi.fn()} />);
}

describe('EventDayCockpit — stale-resume guard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    onlineManager.setOnline(true);
    H.reset();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
    onlineManager.setOnline(true);
  });

  it('renders the cockpit with no overlay while the data is fresh', () => {
    H.set({ dataUpdatedAt: NOW - 10_000 });
    renderCockpit();
    expect(screen.getByText(t.cockpit.pageTitle)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not open on a resume when the oldest tracked read is still fresh', () => {
    H.set({ dataUpdatedAt: NOW - 10_000 });
    renderCockpit();
    resume();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('blocks on a resume with stale data and refetches the WHOLE read set', () => {
    H.set({ dataUpdatedAt: NOW - STALE });
    renderCockpit();
    resume();

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(t.door.resumeSyncingTitle)).toBeTruthy();
    // Including the reads that are NOT allowed to vote on staleness — they still
    // get repaired on resume.
    for (const key of ['guests', 'tiers', 'stats', 'arrivals', 'event', 'guestRequests', 'quotaRequests']) {
      expect(H.refetched[key] ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it('inerts the cockpit body while blocked, and releases it after', () => {
    H.set({ dataUpdatedAt: NOW - STALE });
    const { container } = renderCockpit();
    resume();
    // The search field / Enter-to-check-in handler must not receive a barcode
    // wedge or keyboard while the screen is blocked on stale numbers.
    expect(container.querySelector('[inert]')).not.toBeNull();

    act(() => H.set({ dataUpdatedAt: NOW }));
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('closes itself the moment fresh data lands', () => {
    H.set({ dataUpdatedAt: NOW - STALE });
    renderCockpit();
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    act(() => H.set({ dataUpdatedAt: NOW }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is armed even when a tracked read has never loaded at all', () => {
    // dataUpdatedAt 0 on any one query = part of the screen has no truth behind
    // it; a resume must not sail past that.
    H.set({ dataUpdatedAt: 0 });
    renderCockpit();
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
  });

  it('degrades to the cockpit’s OWN offline copy, never the door’s outbox promise', () => {
    onlineManager.setOnline(false);
    H.set({ dataUpdatedAt: NOW - STALE });
    const { unmount } = renderCockpit();
    resume();

    act(() => vi.advanceTimersByTime(BACKSTOP_MS + 50));

    expect(screen.getByText(t.door.resumeOfflineTitle)).toBeTruthy();
    expect(screen.getByText(t.cockpit.resumeOfflineSub)).toBeTruthy();
    // The door's copy tells the doorhost their check-ins will queue and sync.
    // This surface has no outbox — saying that here would be a lie.
    expect(screen.queryByText(t.door.resumeOfflineSub)).toBeNull();
    unmount(); // before afterEach restores `online` on a live tree
  });

  it('lets the doorhost continue anyway — the cockpit must never lock up', () => {
    onlineManager.setOnline(false);
    H.set({ dataUpdatedAt: NOW - STALE });
    const { container, unmount } = renderCockpit();
    resume();
    act(() => vi.advanceTimersByTime(BACKSTOP_MS + 50));

    act(() => {
      screen.getByRole('button', { name: t.door.resumeContinueAnyway }).click();
    });

    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(container.querySelector('[inert]')).toBeNull();
    unmount(); // before afterEach restores `online` on a live tree
  });
});
