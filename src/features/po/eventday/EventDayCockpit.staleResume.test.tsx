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
 *
 * The fake data layer models React Query per query, not one shared snapshot,
 * because three of the behaviours below are about queries DISAGREEING with each
 * other. It also models the two rules the guard actually depends on: a
 * successful refetch advances that query's `dataUpdatedAt`, and a refetch while
 * offline stays pending (React Query pauses it rather than failing it).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSyncExternalStore } from 'react';
import { act, render, screen } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { t } from '@/lib/i18n';

const KEYS = ['guests', 'tiers', 'stats', 'arrivals', 'event', 'guestRequests', 'quotaRequests'] as const;

const H = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  type Snap = { dataUpdatedAt: number; fetchStatus: 'fetching' | 'paused' | 'idle' };
  const DEFAULT: Snap = { dataUpdatedAt: 0, fetchStatus: 'idle' };
  const keys = ['guests', 'tiers', 'stats', 'arrivals', 'event', 'guestRequests', 'quotaRequests'];
  let snaps: Record<string, Snap> = {};
  let refetched: Record<string, number> = {};
  /** Queries whose refetch resolves but never advances the stamp — i.e. a read
   *  that keeps failing, which is exactly how React Query behaves there. */
  let failing = new Set<string>();
  /** Offline: React Query PAUSES the refetch, so its promise never settles. */
  let paused = false;
  const notify = (): void => listeners.forEach((cb) => cb());
  return {
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    get: (k: string): Snap => snaps[k] ?? DEFAULT,
    count: (k: string): number => refetched[k] ?? 0,
    set: (k: string, next: Partial<Snap>): void => {
      snaps[k] = { ...(snaps[k] ?? DEFAULT), ...next };
      notify();
    },
    setAll: (next: Partial<Snap>): void => {
      for (const k of keys) snaps[k] = { ...(snaps[k] ?? DEFAULT), ...next };
      notify();
    },
    fail: (k: string): void => {
      failing.add(k);
    },
    pauseRefetches: (): void => {
      paused = true;
    },
    refetch: (k: string): Promise<unknown> => {
      refetched[k] = (refetched[k] ?? 0) + 1;
      if (paused) return new Promise(() => undefined); // never settles, like a paused RQ fetch
      if (!failing.has(k)) {
        snaps[k] = { ...(snaps[k] ?? DEFAULT), dataUpdatedAt: Date.now() };
        notify();
      }
      return Promise.resolve({});
    },
    reset: (): void => {
      snaps = {};
      refetched = {};
      failing = new Set();
      paused = false;
    },
  };
});

/** A query result whose freshness the test drives, wired through
 *  useSyncExternalStore so changing it actually re-renders the cockpit. Named as
 *  a hook because that is what it is — it is called from the mocked hooks below,
 *  which are themselves only ever called during render.
 *
 *  `fetchStatus` is still exposed even though the cockpit no longer reads it —
 *  that is what lets the ambient-traffic test below prove the cockpit is immune
 *  to it (86eykg2x1 review round 2). */
function useTrackedQuery<T>(key: string, data: T) {
  const snap = useSyncExternalStore(
    H.subscribe,
    () => H.get(key),
    () => H.get(key),
  );
  return {
    data,
    isLoading: false,
    isSuccess: true,
    dataUpdatedAt: snap.dataUpdatedAt,
    fetchStatus: snap.fetchStatus,
    refetch: () => H.refetch(key),
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

/** hidden → visible: the only transition the guard treats as a resume. Synchronous
 *  on purpose — it leaves the forced refresh IN FLIGHT, which is the state the
 *  blocking overlay exists for. Call `settle()` to let that refresh land. */
function resume(): void {
  act(() => setVisibility('hidden'));
  act(() => setVisibility('visible'));
}

/** Let the in-flight forced refresh resolve and React re-render on the result. */
async function settle(): Promise<void> {
  await act(async () => undefined);
}

function renderCockpit() {
  return render(<EventDayCockpitGate chosenId="ev1" onChoose={vi.fn()} />);
}

function searchField(container: HTMLElement): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`input[placeholder="${t.cockpit.searchCheckIn}"]`);
  if (!el) throw new Error('cockpit quick check-in field not found');
  return el;
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
    H.setAll({ dataUpdatedAt: NOW - 10_000 });
    renderCockpit();
    expect(screen.getByText(t.cockpit.pageTitle)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not open on a resume when the oldest tracked read is still fresh', () => {
    H.setAll({ dataUpdatedAt: NOW - 10_000 });
    renderCockpit();
    resume();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('blocks on a resume with stale data and refetches the WHOLE read set', async () => {
    H.setAll({ dataUpdatedAt: NOW - STALE });
    renderCockpit();
    resume();

    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(screen.getByText(t.door.resumeSyncingTitle)).toBeTruthy();
    // Including the reads that are NOT allowed to vote on staleness — they still
    // get repaired on resume.
    for (const key of KEYS) expect(H.count(key)).toBeGreaterThanOrEqual(1);

    await settle(); // land the in-flight refresh inside act() before teardown
  });

  it('inerts the cockpit body while blocked, and releases it after', async () => {
    H.setAll({ dataUpdatedAt: NOW - STALE });
    const { container } = renderCockpit();
    resume();
    // The search field / Enter-to-check-in handler must not receive a barcode
    // wedge or keyboard while the screen is blocked on stale numbers.
    expect(container.querySelector('[inert]')).not.toBeNull();

    await settle();
    expect(container.querySelector('[inert]')).toBeNull();
  });

  it('closes itself the moment fresh data lands', async () => {
    H.setAll({ dataUpdatedAt: NOW - STALE });
    renderCockpit();
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('is armed even when a LOAD-BEARING read has never loaded at all', async () => {
    // dataUpdatedAt 0 on guests = part of the screen has no truth behind it; a
    // resume must not sail past that.
    H.setAll({ dataUpdatedAt: NOW });
    H.set('guests', { dataUpdatedAt: 0 });
    renderCockpit();
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await settle(); // land the in-flight refresh inside act() before teardown
  });

  it('degrades to the cockpit’s OWN offline copy, never the door’s outbox promise', () => {
    onlineManager.setOnline(false);
    H.pauseRefetches();
    H.setAll({ dataUpdatedAt: NOW - STALE });
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
    H.pauseRefetches();
    H.setAll({ dataUpdatedAt: NOW - STALE });
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

  // ── Review round 2 (86eykg2x1) ─────────────────────────────────────────────

  it('does NOT let a permanently-failing stats read veto the cockpit', async () => {
    // `fetchEventStats` bundles five RPCs and throws if any one errors, and React
    // Query leaves `dataUpdatedAt` at 0 until a first success — so one drifting
    // or 500-ing RPC would otherwise hand a decorative, `canSeeStats`-gated read
    // a PERMANENT veto: every alt-tab blocks check-in and no forced refresh can
    // clear it. Stats is repaired on resume; it does not get to raise the alarm.
    H.setAll({ dataUpdatedAt: NOW });
    H.set('stats', { dataUpdatedAt: 0 });
    H.fail('stats');
    renderCockpit();

    resume();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    // ...and it is still repaired, it just cannot block on its own failure.
    expect(H.count('stats')).toBe(0); // no resume fired, because nothing was stale
    expect(H.get('stats').dataUpdatedAt).toBe(0);

    // Now make the screen genuinely stale: the guard fires, repairs stats too,
    // and still closes on the load-bearing reads even though stats stays broken.
    act(() => {
      H.setAll({ dataUpdatedAt: NOW - STALE });
      H.set('stats', { dataUpdatedAt: 0 });
    });
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    expect(H.count('stats')).toBeGreaterThanOrEqual(1);

    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(H.get('stats').dataUpdatedAt).toBe(0); // never recovered, never mattered
  });

  it('closes on fresh data even while ambient cockpit traffic is still in flight', async () => {
    // The four polled reads are on a 60s refetchInterval AND are invalidated by
    // usePoEventRealtime on every check-in (throttled to 500ms), so during a door
    // rush they are almost never all idle at once. `syncing` must mean "the
    // resume refresh is running", not "some query somewhere is fetching" —
    // otherwise the blocking overlay sits over a demonstrably fresh cockpit and
    // then claims the connection is stuck.
    H.setAll({ dataUpdatedAt: NOW - STALE, fetchStatus: 'fetching' });
    renderCockpit();
    resume();
    expect(screen.getByRole('alertdialog')).toBeTruthy();

    await settle();
    // Every tracked read is fresh; the ambient rush has NOT stopped.
    expect(H.get('guests').fetchStatus).toBe('fetching');
    expect(screen.queryByRole('alertdialog')).toBeNull();

    // And it must not flip to "connection is stuck" on that same traffic either.
    act(() => vi.advanceTimersByTime(BACKSTOP_MS + 50));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('hands keyboard focus back to the quick check-in field when the guard closes', async () => {
    // `inert` makes the browser blur whatever was focused inside the subtree —
    // here the Enter-to-check-in field, i.e. exactly the barcode-wedge target
    // `inert` is protecting. Online the overlay flashes for about a second and
    // auto-closes, so without restoration the next scan types into <body>: no
    // check-in, no error, nothing on screen to explain it.
    H.setAll({ dataUpdatedAt: NOW - STALE });
    const { container } = renderCockpit();
    const input = searchField(container);
    input.focus();
    expect(document.activeElement).toBe(input);

    resume();
    // jsdom implements the `inert` ATTRIBUTE but not its focus semantics, so the
    // blur every real browser performs here is modelled explicitly.
    act(() => input.blur());
    expect(document.activeElement).toBe(document.body);

    await settle();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it('hands focus back after “continue anyway” too', () => {
    // That button is autofocused and is unmounted with focus still on it, which
    // leaves <body> focused just like the inert blur does.
    onlineManager.setOnline(false);
    H.pauseRefetches();
    H.setAll({ dataUpdatedAt: NOW - STALE });
    const { container, unmount } = renderCockpit();
    const input = searchField(container);
    input.focus();

    resume();
    act(() => input.blur()); // model the browser's inert blur (see above)
    act(() => vi.advanceTimersByTime(BACKSTOP_MS + 50));
    act(() => {
      screen.getByRole('button', { name: t.door.resumeContinueAnyway }).click();
    });

    expect(document.activeElement).toBe(input);
    unmount(); // before afterEach restores `online` on a live tree
  });

  it('does not steal focus back if the operator moved it somewhere else', async () => {
    // Restoration is a repair for focus that went NOWHERE. If focus has since
    // landed on a real element, yanking it away would be the worse bug.
    H.setAll({ dataUpdatedAt: NOW - STALE });
    const { container } = renderCockpit();
    const input = searchField(container);
    input.focus();

    resume();
    act(() => input.blur());
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();

    await settle();
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
  });
});
