// @vitest-environment jsdom
/**
 * Venue-switch failure handling in the po shell (86eykm7rk).
 *
 * `switchToVenue` used to chain `.then(() => window.location.assign('/app'))`
 * onto an action that resolved as `Promise<void>` whether or not the server had
 * accepted the switch. A refusal (membership revoked between the render of
 * `myVenues` and the tap) never wrote the cookie, so the reload dropped the user
 * back on the OLD venue with no error — indistinguishable from success and
 * infinitely repeatable. `.catch()` only ever caught real exceptions.
 *
 * Mounts the REAL `PlusOneApp` with the same minimal dependency pinning as
 * `app.auto-open.test.tsx`, and drives the switch through the real `usePo()`
 * context (the Home screen is swapped for a probe button) so the assertion runs
 * against the shipped callback rather than a copy of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/lib/i18n';

const VENUE_A = '018f3a2e-0000-7000-8000-00000000000a';
const VENUE_B = '018f3a2e-0000-7000-8000-00000000000b';

const H = vi.hoisted(() => ({ switchActiveVenueAction: vi.fn() }));
const routerReplace = vi.fn();
const assign = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: routerReplace, back: vi.fn(), push: vi.fn() }),
  usePathname: () => '/app',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/observability/sentry-client', () => ({ setTag: vi.fn(), addBreadcrumb: vi.fn() }));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: VENUE_A, venueName: 'Venue A', roles: ['admin'] }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoCanManageTemplates: () => false,
  usePoIsDoorOrganizer: () => false,
  usePoEvents: () => ({ data: [] }),
  usePoGuestRequests: () => ({ data: [] }),
  usePoDoorCandidates: () => ({ data: [], isLoading: false, isSuccess: true, isFetching: false, refetch: () => {} }),
}));
vi.mock('@/features/door/DoorProvider', () => ({ DoorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/door/DoorQueryProvider', () => ({ DoorQueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/venues/actions', () => ({ switchActiveVenueAction: H.switchActiveVenueAction }));
vi.mock('./screens/events', () => ({ Crew: () => null, EventEdit: () => null, EventView: () => null, Events: () => null, PastEvent: () => null, Tiers: () => null }));
vi.mock('./screens/guests', () => ({ BulkPaste: () => null, Contacten: () => null, ContactProfile: () => null, GuestsTab: () => null }));
vi.mock('./screens/door', () => ({ DoorEventPicker: () => null, PoDoorTab: () => null }));
vi.mock('./screens/settings', () => ({
  Allowance: () => null, Billing: () => null, Gebruikers: () => null, Import: () => null, Meer: () => null,
  Profile: () => null, Rollen: () => null, VenueSettings: () => null, VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
// The Home screen stands in for the venue-switch entry point: it calls the real
// `switchToVenue` off the shell's own context, so this test exercises the
// shipped callback end-to-end. `await import` (not a closed-over binding) keeps
// the context module identity — a second instance would mint a second React
// context and `usePo()` would throw.
vi.mock('./screens/home', async () => {
  const { usePo } = await import('./context');
  return {
    Home: () => {
      const { switchToVenue } = usePo();
      return (
        <button type="button" data-testid="switch" onClick={() => switchToVenue('018f3a2e-0000-7000-8000-00000000000b')}>
          switch
        </button>
      );
    },
  };
});
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
      <AppShellDataProvider
        value={{
          myVenues: [
            { venueId: VENUE_A, venueName: 'Venue A', roles: ['admin'] },
            { venueId: VENUE_B, venueName: 'Venue B', roles: ['admin'] },
          ],
          activeVenueId: VENUE_A,
          serverHint: false,
          statsAccess: { venues: [] },
        }}
      >
        <PlusOneApp />
      </AppShellDataProvider>
    </QueryClientProvider>,
  );
}

async function clickSwitch() {
  await act(async () => {
    screen.getByTestId('switch').click();
    await Promise.resolve();
  });
}

beforeEach(() => {
  H.switchActiveVenueAction.mockReset();
  routerReplace.mockClear();
  assign.mockClear();
  // jsdom's window.location is [LegacyUnforgeable] — spyOn cannot redefine
  // `assign`, but replacing the whole property works.
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { assign, href: 'http://localhost/app', pathname: '/app', search: '', origin: 'http://localhost' },
  });
  try {
    sessionStorage.clear();
  } catch {
    /* ignore */
  }
});

describe('PlusOneApp switchToVenue (86eykm7rk)', () => {
  it('does NOT reload and DOES show an error when the server refuses the switch', async () => {
    H.switchActiveVenueAction.mockResolvedValue('denied');
    renderApp();
    await clickSwitch();

    await waitFor(() => expect(H.switchActiveVenueAction).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    // Asserted BEFORE the toast: "did not navigate" is the load-bearing half of
    // this fix, and it is what regresses if the result is thrown away again.
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByText(t.venue.switchFailed)).toBeDefined();
    // The optimistic "Switching…" toast must be gone — leaving it up is the
    // exact "as if it succeeded" symptom this task fixes.
    expect(screen.queryByText(t.venue.switching)).toBeNull();
  });

  it('reloads onto /app when the switch succeeds', async () => {
    H.switchActiveVenueAction.mockResolvedValue('ok');
    renderApp();
    await clickSwitch();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    expect(screen.queryByText(t.venue.switchFailed)).toBeNull();
  });

  it('still reloads on an expired session, so middleware can route to /login', async () => {
    H.switchActiveVenueAction.mockResolvedValue('unauthenticated');
    renderApp();
    await clickSwitch();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/app'));
    expect(screen.queryByText(t.venue.switchFailed)).toBeNull();
  });

  it('passes the venue id and SAYS SO on a thrown error, instead of going quiet', async () => {
    // Round-2 review: `.catch()` used to `setToast(null)`, which is the very
    // silent failure this task exists to remove, reached by a different door —
    // "Switching…" flashed, the venue never changed, nothing explained why.
    // Deliberately NOT `switchFailed`: the user's access is fine here, so the
    // honest advice is "try again", the opposite of "refresh your venues".
    H.switchActiveVenueAction.mockRejectedValue(new Error('network'));
    renderApp();
    await clickSwitch();

    expect(H.switchActiveVenueAction).toHaveBeenCalledWith(VENUE_B);
    await waitFor(() => expect(screen.getByText(t.venue.switchError)).toBeDefined());
    expect(screen.queryByText(t.venue.switching)).toBeNull();
    expect(screen.queryByText(t.venue.switchFailed)).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not let a refused switch clear the NEXT switch\'s "Switching…" toast', async () => {
    // Round-2 review: the error toast used to arm a bare `setTimeout` inside a
    // promise callback, so its 6s clear survived into whatever came next. Tap a
    // refused venue, then a valid one 3s later, and at t=6s the stale timer wiped
    // the in-flight "Switching…" while that second switch was still running.
    // The effect + cleanup idiom (app.tsx's billing toast, guests/profile.tsx)
    // cancels the old timer when a new toast replaces it.
    vi.useFakeTimers();
    try {
      H.switchActiveVenueAction.mockResolvedValue('denied');
      renderApp();
      await clickSwitch();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(t.venue.switchFailed)).toBeDefined();

      // 3s later: a second switch that the server has not answered yet.
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      H.switchActiveVenueAction.mockReturnValue(new Promise(() => {})); // never settles
      await act(async () => {
        screen.getByTestId('switch').click();
        await Promise.resolve();
      });
      expect(screen.getByText(t.venue.switching)).toBeDefined();

      // t=6s from the FIRST tap: the old timer must not be alive any more.
      await act(async () => {
        vi.advanceTimersByTime(3500);
      });
      expect(screen.getByText(t.venue.switching)).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the refusal toast on its own timer', async () => {
    // The other half of the same contract: sticky is right for "Switching…"
    // (the reload ends it), but an error the user has read must go away.
    vi.useFakeTimers();
    try {
      H.switchActiveVenueAction.mockResolvedValue('denied');
      renderApp();
      await clickSwitch();
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(t.venue.switchFailed)).toBeDefined();
      await act(async () => {
        vi.advanceTimersByTime(6500);
      });
      expect(screen.queryByText(t.venue.switchFailed)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
