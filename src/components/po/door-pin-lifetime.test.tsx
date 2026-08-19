// @vitest-environment jsdom
/**
 * Round-2 review of PR #278 (86eykm7qp): the pin's LIFETIME, not the pin itself.
 *
 * The first round pinned the implicit single-candidate door choice into the URL
 * via `replaceDoorState`, but guarded the write with a `useRef` that recorded
 * "we have written this id before". Ref and URL have different lifetimes, and
 * every gap between them leaked:
 *
 *  1. ONE-SHOT PIN. `doorState.eventId` can go back to `null` WITHOUT a remount:
 *     `useDoorOverride`'s popstate listener drops the override on any back/forward
 *     (it exists precisely because Next's hooks don't re-fire on a raw-history pop,
 *     86ey9tq62), and for a door entered via the bottom tab there is no `?event=`
 *     in Next's tracked search string to fall back to. The ref still held the id,
 *     so the re-pin was refused and the door went back to being derived from
 *     `doorCandidates.length === 1` every render — the original bug, restored by
 *     the single most common gesture at the door (hardware back out of an overlay).
 *
 *  2. PIN WITHOUT RELEASE. The pin survives a reload (it is in the URL); the ref
 *     does not. On the next night's reload the requested id is rejected by
 *     validation, the release never fires (fresh ref is `null`), and with exactly
 *     one candidate the picker does not render either — a dead screen whose only
 *     escape is switching tabs, with nothing on screen saying so.
 *
 * Both are asserted here against the REAL `PlusOneApp`. The fix makes the write
 * guard ask "is the state already what I would write?" (self-healing) instead of
 * "have I ever written this?" (sticky), and derives the release from the candidate
 * list's own settled verdict instead of from a memory of who chose the id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShellDataProvider } from './app-shell-data';

const EVENT_A = 'ev-a';
const EVENT_B = 'ev-b';

const H = vi.hoisted(() => ({
  candidates: [] as { id: string; name: string }[],
  /** Next's tracked search string. Frozen across raw-history calls on purpose —
   *  that is exactly what `useDoorOverride`'s listener #2 is built on. */
  trackedSearch: '',
  isFetching: false,
  refetchCalls: 0,
  doorMounts: 0,
  doorUnmounts: 0,
  channelTeardowns: 0,
  openChannels: [] as string[],
  pickerMounts: 0,
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/door',
  useSearchParams: () => new URLSearchParams(H.trackedSearch),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = (): null => null;
    return Stub;
  },
}));
vi.mock('@/lib/observability/sentry-client', () => ({
  setTag: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
}));
vi.mock('@/features/venues/actions', () => ({ setActiveVenueAction: vi.fn() }));
vi.mock('@/features/po/door-event', () => ({ autoOpenDoorEvent: () => null }));
vi.mock('./use-viewport', () => ({ useViewport: () => true }));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u-door', venueId: 'v1', roles: ['doorhost'] }),
}));

vi.mock('@/features/po/hooks', () => ({
  // Models the real query closely enough for the lifetime questions: `refetch()`
  // is what flips `isFetching`, and `isFetching` is in this query's
  // `notifyOnChangeProps`, so it is the re-render signal the release waits on.
  usePoDoorCandidates: () => ({
    data: H.candidates,
    isLoading: false,
    isFetching: H.isFetching,
    isSuccess: true,
    refetch: () => {
      H.refetchCalls += 1;
      return Promise.resolve();
    },
  }),
  usePoEvents: () => ({ data: [] }),
  usePoGuestRequests: () => ({ data: [] }),
  usePoCanManageTemplates: () => false,
  usePoIsDoorOrganizer: () => false,
}));

vi.mock('@/features/door/DoorProvider', async () => {
  const { useEffect } = await import('react');
  return {
    DoorProvider: ({ eventId, children }: { eventId: string; children?: unknown }) => {
      useEffect(() => {
        H.doorMounts += 1;
        const channel = `door:${eventId}`;
        H.openChannels.push(channel);
        return () => {
          H.doorUnmounts += 1;
          H.channelTeardowns += 1;
          H.openChannels = H.openChannels.filter((c) => c !== channel);
        };
      }, [eventId]);
      return <div data-testid="door-provider">{children as never}</div>;
    },
  };
});
vi.mock('@/features/door/DoorQueryProvider', () => ({
  DoorQueryProvider: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));
vi.mock('./screens/door', async () => {
  const { useEffect } = await import('react');
  return {
    PoDoorTab: () => <div data-testid="door-tab" />,
    DoorEventPicker: () => {
      useEffect(() => {
        H.pickerMounts += 1;
      }, []);
      return <div data-testid="door-picker" />;
    },
  };
});
vi.mock('./screens/events', () => ({
  Crew: () => null,
  EventEdit: () => null,
  EventView: () => null,
  Events: () => null,
  PastEvent: () => null,
  Tiers: () => null,
}));
vi.mock('./screens/guests', () => ({
  BulkPaste: () => null,
  Contacten: () => null,
  ContactProfile: () => null,
  GuestsTab: () => null,
}));
vi.mock('./screens/settings', () => ({
  Allowance: () => null,
  Billing: () => null,
  Gebruikers: () => null,
  Import: () => null,
  Meer: () => null,
  Profile: () => null,
  Rollen: () => null,
  VenueSettings: () => null,
  VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
vi.mock('./screens/home', () => ({ Home: () => null }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
vi.mock('./shell-responsive', () => ({
  ResponsiveShell: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));

const { PlusOneApp } = await import('./app');

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const tree = () => (
  <QueryClientProvider client={client}>
    <AppShellDataProvider
      value={{ myVenues: [], activeVenueId: 'v1', serverHint: true, statsAccess: { venues: [] } }}
    >
      <PlusOneApp />
    </AppShellDataProvider>
  </QueryClientProvider>
);

/** Drive the candidate query's one stale-id retry to completion, exactly as the
 *  real query does: `refetch()` flips `isFetching` true, then it settles false.
 *  The release must wait for that settle — releasing on the issuing render would
 *  drop a pin whose event the retry is about to bring back. */
async function settleStaleRetry(view: { rerender: (ui: React.ReactElement) => void }) {
  await act(async () => {
    H.isFetching = true;
    view.rerender(tree());
  });
  await act(async () => {
    H.isFetching = false;
    view.rerender(tree());
  });
}

describe('the door pin outlives neither its release nor a back gesture (86eykm7qp round 2)', () => {
  beforeEach(() => {
    H.trackedSearch = '';
    H.candidates = [{ id: EVENT_A, name: 'Vrijdag' }];
    H.isFetching = false;
    H.refetchCalls = 0;
    H.doorMounts = 0;
    H.doorUnmounts = 0;
    H.channelTeardowns = 0;
    H.openChannels = [];
    H.pickerMounts = 0;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('re-pins after a hardware-back gesture drops the door override, so the door still survives a second live event', async () => {
    window.history.replaceState({}, '', '/app/door');
    const view = render(tree());

    expect(window.location.search).toContain(`event=${EVENT_A}`);
    expect(H.doorMounts).toBe(1);

    // Open a guest overlay (raw history, no router round-trip — invariant #25)
    // and close it with the Android hardware back button. `useDoorOverride`'s
    // popstate listener drops the override by design; Next's tracked search
    // string never saw the raw pushState, so it is still ''.
    await act(async () => {
      window.history.pushState(window.history.state, '', `/app/door?event=${EVENT_A}&guest=g1`);
      window.history.back();
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      view.rerender(tree());
    });

    // The pin must be back in the URL — a one-shot pin leaves it derived again.
    expect(window.location.search).toContain(`event=${EVENT_A}`);

    // ...and that is what has to hold when the next party goes live mid-shift.
    await act(async () => {
      H.candidates = [
        { id: EVENT_A, name: 'Vrijdag' },
        { id: EVENT_B, name: 'Zaterdag' },
      ];
      view.rerender(tree());
    });

    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(view.queryByTestId('door-picker')).toBeNull();
    expect(H.pickerMounts).toBe(0);
    expect(H.channelTeardowns).toBe(0);
    expect(H.doorUnmounts).toBe(0);
    expect(H.openChannels).toEqual([`door:${EVENT_A}`]);
    view.unmount();
  });

  it('releases a pinned id the candidate list has rejected on a FRESH mount, so a reloaded stale pin is not a dead screen', async () => {
    // Next night: the webview reloads yesterday's pinned URL. Nothing in memory
    // survives a reload — the pin does, because it is in the URL.
    window.history.replaceState({}, '', `/app/door?event=${EVENT_A}`);
    H.trackedSearch = `event=${EVENT_A}`;
    H.candidates = [{ id: EVENT_B, name: 'Zaterdag' }];

    const view = render(tree());
    await settleStaleRetry(view);
    await act(async () => {
      view.rerender(tree());
    });

    // Tonight's event is the only candidate, so there is no picker to escape to
    // and no "ander event" control: the release is the only way out.
    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(H.openChannels).toEqual([`door:${EVENT_B}`]);
    expect(window.location.search).toContain(`event=${EVENT_B}`);
    view.unmount();
  });

  it('still writes the pin exactly once at mount and never on an idle re-render', async () => {
    // The round-1 `pinnedDoorRef` was the render-loop guard as well as the
    // one-shot record, and only the record was wrong. Removing it must not cost
    // the loop guard: `replaceDoorState` sets state, so a guard that re-fired on
    // its own write would spin. Counted on the real `history.replaceState`,
    // which is the write this effect actually performs.
    window.history.replaceState({}, '', '/app/door');
    const real = window.history.replaceState.bind(window.history);
    let writes = 0;
    const spy = vi
      .spyOn(window.history, 'replaceState')
      .mockImplementation((...args: Parameters<typeof real>) => {
        writes += 1;
        return real(...args);
      });
    try {
      const view = render(tree());
      expect(writes).toBe(1);
      expect(window.location.search).toContain(`event=${EVENT_A}`);

      // Re-renders that change nothing the door cares about must write nothing.
      for (let i = 0; i < 3; i += 1) {
        await act(async () => {
          view.rerender(tree());
        });
      }
      expect(writes).toBe(1);

      // A second event going live is a real change, but not one that alters the
      // pinned id — so still nothing to write.
      await act(async () => {
        H.candidates = [
          { id: EVENT_A, name: 'Vrijdag' },
          { id: EVENT_B, name: 'Zaterdag' },
        ];
        view.rerender(tree());
      });
      expect(writes).toBe(1);
      view.unmount();
    } finally {
      spy.mockRestore();
    }
  });

  it('does not release a requested id before its one stale-list retry has settled', async () => {
    // An explicit "Check-in" pick for an event a colleague created seconds ago:
    // the local candidate list is merely stale, and the retry is about to bring
    // the event back. Releasing on the issuing render would strand the host on
    // the wrong event, so the release must wait.
    window.history.replaceState({}, '', `/app/door?event=${EVENT_A}`);
    H.trackedSearch = `event=${EVENT_A}`;
    H.candidates = [{ id: EVENT_B, name: 'Zaterdag' }];

    const view = render(tree());
    expect(H.refetchCalls).toBe(1);
    expect(window.location.search).toContain(`event=${EVENT_A}`); // not dropped yet

    await act(async () => {
      H.isFetching = true;
      view.rerender(tree());
    });
    await act(async () => {
      // The retry lands and the event is real after all.
      H.isFetching = false;
      H.candidates = [
        { id: EVENT_A, name: 'Vrijdag' },
        { id: EVENT_B, name: 'Zaterdag' },
      ];
      view.rerender(tree());
    });

    expect(window.location.search).toContain(`event=${EVENT_A}`);
    expect(view.queryByTestId('door-provider')).not.toBeNull();
    expect(H.openChannels).toEqual([`door:${EVENT_A}`]);
    view.unmount();
  });
});
