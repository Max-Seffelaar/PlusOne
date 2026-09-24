// @vitest-environment jsdom
/**
 * The door subtree does not re-render when the rest of the shell does
 * (86eykm76k) — measured with real render counters against the real
 * `PlusOneApp`, not argued from the source's shape.
 *
 * This REPLACES `tests/unit/door-tab-element-identity-bailout.test.ts`. That
 * guard asserted, by reading `app.tsx` as text, that the door tab element was
 * built with `useMemo` and handed to `<DoorProvider>` as a bare identifier, and
 * that every provider in between forwarded `children` untouched. All three were
 * true, and all three have stopped existing: the door is its own component now,
 * and `usePoEvents`/`usePoDoorCandidates`/`usePoGuestRequests` are read in its
 * siblings rather than its ancestors, so an unrelated shell update cannot
 * schedule a door render at all. A source-shape assertion about a memo that is
 * gone can only be deleted; what it was ultimately protecting is the OUTCOME,
 * and that is what is asserted here instead.
 *
 * MEASUREMENT NOTE. Each mocked query is a real subscribable store read through
 * `useSyncExternalStore`, and the tests push data into those stores rather than
 * calling `rerender(<App/>)`. That distinction is the whole test: re-rendering
 * from the root re-renders the root, which is exactly the thing being measured,
 * and an earlier draft of this file passed even with a venue-wide query moved
 * back into the shell root for precisely that reason.
 *
 * Two counters, because they answer different questions:
 *  · `candidateReads` — one per render of the door's resolver (`MobileDoorBranch`,
 *    the only mounted component reading the candidate query). Zero movement means
 *    the door subtree was never entered: the STRUCTURAL claim.
 *  · `doorTabRenders` — one per render of `PoDoorTab`, the check-in list itself:
 *    the OUTCOME claim.
 *
 * Every test names the regression it is red for, each verified by making that
 * change and watching it fail:
 *  1. a venue-wide query creeping back into the shell root  → `candidateReads` moves;
 *  2. `DoorTree` losing its `React.memo`                    → `doorTabRenders` moves;
 *  3. the control — a door frozen by an over-eager memo would satisfy 1 and 2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShellDataProvider } from './app-shell-data';

const EVENT_A = 'ev-a';

const H = vi.hoisted(() => {
  function makeStore<T>(initial: T) {
    let value = initial;
    const subs = new Set<() => void>();
    return {
      get: (): T => value,
      set: (v: T): void => {
        value = v;
        subs.forEach((f) => f());
      },
      subscribe: (f: () => void): (() => void) => {
        subs.add(f);
        return () => {
          subs.delete(f);
        };
      },
    };
  }
  return {
    candidates: makeStore<{ id: string; name: string }[]>([]),
    events: makeStore<{ id: string; name: string }[]>([]),
    guestRequests: makeStore<{ id: string; status: string }[]>([]),
    isFetching: makeStore(false),
    counts: { candidateReads: 0, doorTabRenders: 0, chromeRenders: 0 },
    lastDoorTab: '' as string,
    onDoorTab: null as null | ((seg: 'deur' | 'taken') => void),
  };
});

vi.mock('next/navigation', () => ({
  usePathname: () => '/app/door',
  useSearchParams: () => new URLSearchParams(''),
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
vi.mock('@/features/venues/actions', () => ({ switchActiveVenueAction: vi.fn() }));
vi.mock('@/features/po/door-event', () => ({ autoOpenDoorEvent: () => null }));
vi.mock('./use-viewport', () => ({ useViewport: () => true }));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u-door', venueId: 'v1', roles: ['doorhost'] }),
}));

vi.mock('@/features/po/hooks', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    usePoDoorCandidates: () => {
      H.counts.candidateReads += 1;
      const data = useSyncExternalStore(H.candidates.subscribe, H.candidates.get, H.candidates.get);
      const isFetching = useSyncExternalStore(H.isFetching.subscribe, H.isFetching.get, H.isFetching.get);
      return { data, isLoading: false, isFetching, isSuccess: true, refetch: () => Promise.resolve() };
    },
    usePoEvents: () => ({ data: useSyncExternalStore(H.events.subscribe, H.events.get, H.events.get) }),
    usePoGuestRequests: () => ({
      data: useSyncExternalStore(H.guestRequests.subscribe, H.guestRequests.get, H.guestRequests.get),
    }),
    usePoCanManageTemplates: () => false,
    usePoIsDoorOrganizer: () => false,
    // P-04: the chrome reads this for the Platform nav entry. Static here —
    // it is a chrome-only read, so it must not be able to move the door
    // counters either way.
    usePoIsPlatformAdmin: () => false,
  };
});
// The open-requests badge counts "pending" — keep the real shape honest.
vi.mock('@/features/po/adapters', () => ({
  isOpenGuestRequest: (r: { status: string }) => r.status === 'pending',
}));

vi.mock('@/features/door/DoorProvider', () => ({
  DoorProvider: ({ children }: { children?: unknown }) => <div data-testid="door-provider">{children as never}</div>,
}));
vi.mock('@/features/door/DoorQueryProvider', () => ({
  DoorQueryProvider: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
}));
vi.mock('./screens/door', () => ({
  PoDoorTab: ({ tab, onTab }: { tab: string; onTab?: (seg: 'deur' | 'taken') => void }) => {
    H.counts.doorTabRenders += 1;
    H.lastDoorTab = tab;
    H.onDoorTab = onTab ?? null;
    return <div data-testid="door-tab">{tab}</div>;
  },
  DoorEventPicker: () => <div data-testid="door-picker" />,
}));
vi.mock('./screens/events', () => ({
  Crew: () => null, EventEdit: () => null, EventView: () => null,
  Events: () => null, PastEvent: () => null, Tiers: () => null,
}));
vi.mock('./screens/guests', () => ({
  BulkPaste: () => null, Contacten: () => null, ContactProfile: () => null, GuestsTab: () => null,
}));
vi.mock('./screens/settings', () => ({
  Allowance: () => null, Billing: () => null, Gebruikers: () => null, Import: () => null,
  Meer: () => null, Profile: () => null, Rollen: () => null, VenueSettings: () => null, VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
vi.mock('./screens/home', () => ({ Home: () => null }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
vi.mock('./shell-responsive', () => ({
  ResponsiveShell: ({ children }: { children?: unknown }) => {
    H.counts.chromeRenders += 1;
    return <div>{children as never}</div>;
  },
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

describe('door render isolation (86eykm76k)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/app/door');
    H.candidates.set([{ id: EVENT_A, name: 'Vrijdag' }]);
    H.events.set([{ id: EVENT_A, name: 'Vrijdag' }]);
    H.guestRequests.set([]);
    H.isFetching.set(false);
    H.counts.candidateReads = 0;
    H.counts.doorTabRenders = 0;
    H.counts.chromeRenders = 0;
    H.lastDoorTab = '';
    H.onDoorTab = null;
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('an unrelated venue-wide update re-renders the chrome and never enters the door subtree', async () => {
    const view = render(tree());
    expect(view.queryByTestId('door-tab')).not.toBeNull();
    const base = { ...H.counts };
    expect(base.doorTabRenders).toBeGreaterThan(0);

    // A guest request comes in while the doorhost is mid-shift. It changes the
    // open-requests badge in the sidebar/More tab and nothing else — the
    // canonical "unrelated shell update".
    await act(async () => {
      H.guestRequests.set([{ id: 'r1', status: 'pending' }]);
    });

    // The stimulus really landed: without this the test would pass just as
    // happily if nothing at all had re-rendered.
    expect(H.counts.chromeRenders, 'the badge change never reached the chrome').toBeGreaterThan(base.chromeRenders);
    // ...and it did not reach the door, at either depth.
    expect(H.counts.candidateReads, 'an unrelated shell update re-rendered the door branch').toBe(base.candidateReads);
    expect(H.counts.doorTabRenders, 'an unrelated shell update re-rendered PoDoorTab').toBe(base.doorTabRenders);

    // The venue's event list is the other query the shell root used to read.
    // While the door is open, `AppScreens` is not even mounted, so a refetch
    // there re-renders nothing whatsoever — including the chrome.
    const afterBadge = { ...H.counts };
    await act(async () => {
      H.events.set([{ id: EVENT_A, name: 'Vrijdag' }, { id: 'ev-new', name: 'Zaterdag' }]);
    });
    expect(H.counts, 'an event-list refetch re-rendered part of the shell').toEqual(afterBadge);
    view.unmount();
  });

  it('the candidate query churning its fetch state re-renders the door resolver but not the door itself', async () => {
    const view = render(tree());
    const base = { ...H.counts };

    // `usePoDoorCandidates` declares `isFetching` in its notifyOnChangeProps and
    // the resolver reads it, so every background refetch re-renders
    // `MobileDoorBranch` twice. `DoorTree`'s React.memo is what keeps that off
    // the virtualized check-in list.
    await act(async () => {
      H.isFetching.set(true);
    });
    await act(async () => {
      H.isFetching.set(false);
    });

    expect(H.counts.candidateReads, 'the fetch-state churn never reached the door resolver').toBeGreaterThan(
      base.candidateReads,
    );
    expect(H.counts.doorTabRenders, 'a candidate refetch re-rendered PoDoorTab').toBe(base.doorTabRenders);
    view.unmount();
  });

  it('a real door state change still reaches PoDoorTab (the isolation is not a frozen door)', async () => {
    const view = render(tree());
    expect(H.lastDoorTab).toBe('deur');
    const base = { ...H.counts };

    // Deur → Taken, driven through the handler the door itself was handed, so
    // this exercises the real raw-history sub-nav (invariant #25: no router
    // round-trip) rather than poking state from outside.
    await act(async () => {
      H.onDoorTab?.('taken');
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(H.counts.doorTabRenders, 'the door never re-rendered on its own state change').toBeGreaterThan(
      base.doorTabRenders,
    );
    expect(H.lastDoorTab, 'the new segment never reached PoDoorTab').toBe('taken');
    expect(window.location.search, 'the segment switch never reached the URL').toContain('seg=taken');
    view.unmount();
  });
});
