// @vitest-environment jsdom
/**
 * Regression cover for the T6 desktop auto-open effect in `app.tsx` (86ey9e9vc
 * review round 2, Blocker 2). `doorCandidatesQuery.data` is never `undefined`
 * now (usePoDoorCandidates' stable-empty-array fallback), so the effect's old
 * `if (!cands) return;` guard could never fire — it consumed its one-shot
 * evaluation on the FIRST render (candidates still loading, `data` already
 * `[]`), permanently arming the sessionStorage flag before the real candidate
 * list ever arrived. The fix gates on `doorCandidatesQuery.isSuccess` instead.
 *
 * Mounts the REAL `PlusOneApp` with its data/routing dependencies mocked (no
 * existing test does this — the shell has a heavy hook surface, so every
 * dependency below is deliberately pinned to the minimum needed for THIS
 * effect's guard logic, not a general-purpose app.tsx harness).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSyncExternalStore } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PoDoorEvent } from '@/features/po/door-event';

// A tiny useSyncExternalStore-backed mock so mutating "the query result"
// between renders actually notifies React — a plain mocked hook returning a
// fixed object wouldn't re-render PlusOneApp when the test flips a field.
const H = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: {
    data: PoDoorEvent[];
    isLoading: boolean;
    isSuccess: boolean;
    isFetching: boolean;
    refetch: () => void;
  } = { data: [], isLoading: true, isSuccess: false, isFetching: true, refetch: () => {} };
  return {
    store: {
      subscribe: (cb: () => void) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      getSnapshot: () => snapshot,
      set: (next: typeof snapshot) => {
        snapshot = next;
        listeners.forEach((cb) => cb());
      },
      reset: () => {
        snapshot = { data: [], isLoading: true, isSuccess: false, isFetching: true, refetch: () => {} };
      },
    },
  };
});
const routerReplace = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, back: vi.fn(), push: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/observability/sentry-client', () => ({ setTag: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: 'v1', venueName: 'Venue', roles: ['doorhost'] }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoCanManageTemplates: () => false,
  usePoIsDoorOrganizer: () => false,
  usePoEvents: () => ({ data: [] }),
  usePoGuestRequests: () => ({ data: [] }),
  usePoDoorCandidates: () => useSyncExternalStore(H.store.subscribe, H.store.getSnapshot),
}));
vi.mock('@/features/door/DoorProvider', () => ({ DoorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/door/DoorQueryProvider', () => ({ DoorQueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/venues/actions', () => ({ switchActiveVenueAction: vi.fn() }));
vi.mock('./screens/events', () => ({ Crew: () => null, EventEdit: () => null, EventView: () => null, Events: () => null, PastEvent: () => null, Tiers: () => null }));
vi.mock('./screens/guests', () => ({ BulkPaste: () => null, Contacten: () => null, ContactProfile: () => null, GuestsTab: () => null }));
vi.mock('./screens/door', () => ({ DoorEventPicker: () => null, PoDoorTab: () => null }));
vi.mock('./screens/settings', () => ({
  Allowance: () => null, Billing: () => null, Gebruikers: () => null, Import: () => null, Meer: () => null,
  Profile: () => null, Rollen: () => null, VenueSettings: () => null, VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
vi.mock('./screens/home', () => ({ Home: () => <div>home-screen</div> }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
vi.mock('./shell-responsive', () => ({
  ResponsiveShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const { PlusOneApp } = await import('./app');
const { AppShellDataProvider } = await import('./app-shell-data');

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppShellDataProvider value={{ myVenues: [], activeVenueId: 'v1', serverHint: false, statsAccess: { venues: [] } }}>
        <PlusOneApp />
      </AppShellDataProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  H.store.reset();
  routerReplace.mockClear();
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('PlusOneApp T6 desktop auto-open (86ey9e9vc review round 2, Blocker 2)', () => {
  it('does not consume its one-shot evaluation while door candidates are still loading', async () => {
    renderApp();
    // Settle whatever effects fire on mount while candidates are still
    // unresolved (isSuccess: false, data: []) — matches DEFAULT_SNAPSHOT.
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerReplace).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('po:eventday-auto:u1')).toBeNull();
  });

  it('auto-opens the door once candidates resolve with exactly one event', async () => {
    renderApp();
    await act(async () => {
      await Promise.resolve();
    });
    expect(routerReplace).not.toHaveBeenCalled(); // still loading

    await act(async () => {
      H.store.set({
        // `autoOpenDoorEvent` (door-event.ts) requires `startsAt` to parse
        // and be within its window (now >= start - 1h) — a bare {id, name}
        // candidate silently fails that filter and looks identical to "no
        // eligible event" from this test's point of view. Fixed past
        // timestamp keeps it deterministic.
        data: [{ id: 'e1', name: 'Only Event', venueName: 'Venue', phase: 'live', startsAt: '2020-01-01T20:00:00Z', endsAt: null }],
        isLoading: false,
        isSuccess: true,
        isFetching: false,
        refetch: () => {},
      });
    });

    await waitFor(() => expect(routerReplace).toHaveBeenCalledTimes(1));
    expect(routerReplace).toHaveBeenCalledWith(expect.stringContaining('e1'));
    expect(sessionStorage.getItem('po:eventday-auto:u1')).toBe('1');
  });
});
