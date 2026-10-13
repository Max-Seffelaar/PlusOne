// @vitest-environment jsdom
/**
 * Review #492 (security-shaped): po screens navigate client-only, so a tap no
 * longer passes the middleware that sends a dead session to /login. The shell
 * listens for the auth client's SIGNED_OUT and makes the NEXT navigation a full
 * load instead (never a redirect from the event itself: that would race the
 * device wipe in signOutDevice). Mounts the real PlusOneApp, pinned like
 * app.venue-switch.test.tsx.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const VENUE_A = '018f3a2e-0000-7000-8000-00000000000a';
const VENUE_B = '018f3a2e-0000-7000-8000-00000000000b';

const H = vi.hoisted(() => ({ authCb: null as null | ((event: string) => void) }));
const routerReplace = vi.fn();
const assign = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      onAuthStateChange: (cb: (event: string) => void) => {
        H.authCb = cb;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
    },
  }),
}));
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
  usePoOpenRequestCount: () => ({ data: 0 }),
  // P-04: the chrome reads this for the Platform nav entry.
  usePoIsPlatformAdmin: () => false,
  usePoDoorCandidates: () => ({ data: [], isLoading: false, isSuccess: true, isFetching: false, refetch: () => {} }),
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
// The Home screen stands in for the venue-switch entry point: it calls the real
// `switchToVenue` off the shell's own context, so this test exercises the
// shipped callback end-to-end. `await import` (not a closed-over binding) keeps
// the context module identity — a second instance would mint a second React
// context and `usePo()` would throw.
vi.mock('./screens/home', async () => {
  const { useNav } = await import('./context');
  return {
    Home: () => {
      const nav = useNav();
      return (
        <button type="button" data-testid="go" onClick={() => nav.push('contacten')}>
          go
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


describe('PlusOneApp — a dead session reaches /login on the next tap (review #492)', () => {
  it('navigates client-only while signed in, and with a full load after SIGNED_OUT', async () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { assign, replace: vi.fn(), href: 'http://localhost/app', pathname: '/app', search: '', origin: 'http://localhost' },
    });
    const push = vi.spyOn(window.history, 'pushState').mockImplementation(() => {});
    renderApp();

    await act(async () => {
      screen.getByTestId('go').click();
      await Promise.resolve();
    });
    expect(push).toHaveBeenCalledWith(null, '', '/app/contacts');
    expect(assign).not.toHaveBeenCalled();

    // The auth client drops the session (remote logout, revoked refresh token).
    expect(H.authCb).not.toBeNull();
    act(() => H.authCb?.('SIGNED_OUT'));
    // The event itself navigates nowhere (signOutDevice may still be wiping).
    expect(assign).not.toHaveBeenCalled();

    push.mockClear();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0)); // past the one-gesture nav guard
      screen.getByTestId('go').click();
      await Promise.resolve();
    });
    expect(assign).toHaveBeenCalledWith('/app/contacts');
    expect(push).not.toHaveBeenCalled();
  });
});
