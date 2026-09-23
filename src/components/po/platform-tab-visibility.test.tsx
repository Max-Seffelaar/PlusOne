// @vitest-environment jsdom
/**
 * Platform-tab visibility (P-04, z8uq9m0tnw).
 *
 * Two claims, both against the REAL `PlusOneApp` rather than a copy of the nav
 * list:
 *
 *  1. The Platform nav entry appears only for a platform admin. It is a UI
 *     gate, so it can regress silently: nothing else fails if the entry is
 *     rendered unconditionally, and the screen behind it would simply look
 *     empty to a venue user.
 *  2. A non-platform-admin who navigates to `/app/platform` (a guessed or
 *     shared URL) lands on the flat "not available" state. RLS is the real
 *     boundary, but the screen must not fire the platform reads at all, and it
 *     must not pretend the surface is loading.
 *
 * `ResponsiveShell` is stubbed down to the nav labels: this test is about which
 * entries exist, not how the shell paints them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { t } from '@/lib/i18n';

const VENUE_A = '018f3a2e-0000-7000-8000-00000000000a';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  pathname: '/app',
  invitesCalls: 0,
  funnelCalls: 0,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), back: vi.fn(), push: vi.fn() }),
  usePathname: () => H.pathname,
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
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformInvites: () => {
    H.invitesCalls += 1;
    return { data: [], isLoading: false, isError: false };
  },
  usePoPlatformFunnel: () => {
    H.funnelCalls += 1;
    return { data: undefined };
  },
}));
vi.mock('@/features/po/mutations', () => ({
  usePoInviteBetaCustomer: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
  usePoResendBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
  usePoRevokeBetaInvite: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false }),
}));
vi.mock('@/features/door/DoorProvider', () => ({ DoorProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/features/door/DoorQueryProvider', () => ({ DoorQueryProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('./screens/events', () => ({ Crew: () => null, EventEdit: () => null, EventView: () => null, Events: () => null, PastEvent: () => null, Tiers: () => null }));
vi.mock('./screens/guests', () => ({ BulkPaste: () => null, Contacten: () => null, ContactProfile: () => null, GuestsTab: () => null }));
vi.mock('./screens/door', () => ({ DoorEventPicker: () => null, PoDoorTab: () => null }));
vi.mock('./screens/settings', () => ({
  Allowance: () => null, Billing: () => null, Gebruikers: () => null, Import: () => null, Meer: () => null,
  Profile: () => null, Rollen: () => null, VenueSettings: () => null, VenueSwitch: () => null,
}));
vi.mock('./screens/onboarding', () => ({ VenueCreate: () => null }));
vi.mock('./screens/home', () => ({ Home: () => null }));
vi.mock('@/features/po/eventday/EventDaySkeleton', () => ({ EventDaySkeleton: () => null }));
// `next/dynamic` resolves the lazy screen chunk through the real bundler at
// runtime; here it becomes a plain load-on-mount wrapper, so `await waitFor`
// is enough to get the Platform screen on screen.
vi.mock('next/dynamic', async () => {
  const react = await import('react');
  return {
    default: (loader: () => Promise<react.ComponentType>) => {
      function Lazy(props: Record<string, unknown>): react.ReactElement | null {
        const [C, setC] = react.useState<{ c: react.ComponentType | null }>({ c: null });
        react.useEffect(() => {
          void loader().then((m) => setC({ c: m }));
        }, []);
        return C.c ? react.createElement(C.c, props) : null;
      }
      return Lazy;
    },
  };
});
vi.mock('./shell-responsive', () => ({
  ResponsiveShell: ({
    navItems,
    children,
  }: {
    navItems: { key: string; label: string }[];
    children: React.ReactNode;
  }) => (
    <div>
      <nav data-testid="nav">{navItems.map((n) => <span key={n.key} data-testid={`nav-${n.key}`}>{n.label}</span>)}</nav>
      {children}
    </div>
  ),
}));

const { PlusOneApp } = await import('./app');
const { AppShellDataProvider } = await import('./app-shell-data');

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AppShellDataProvider
        value={{
          myVenues: [{ venueId: VENUE_A, venueName: 'Venue A', roles: ['admin'] }],
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

beforeEach(() => {
  H.isPlatformAdmin = false;
  H.pathname = '/app';
  H.invitesCalls = 0;
  H.funnelCalls = 0;
});

describe('Platform tab visibility (z8uq9m0tnw)', () => {
  it('hides the Platform nav entry for a venue admin who is not a platform admin', () => {
    renderApp();
    expect(screen.queryByTestId('nav-platform')).toBeNull();
  });

  it('shows the Platform nav entry for a platform admin', () => {
    H.isPlatformAdmin = true;
    renderApp();
    expect(screen.getByTestId('nav-platform').textContent).toBe(t.platform.navLabel);
  });

  it('shows "not available" and fires NO platform read on /app/platform without the flag', async () => {
    H.pathname = '/app/platform';
    renderApp();
    await waitFor(() => expect(screen.getByText(t.platform.notAvailable)).toBeDefined());
    expect(H.invitesCalls).toBe(0);
    expect(H.funnelCalls).toBe(0);
    expect(screen.queryByTestId('nav-platform')).toBeNull();
  });

  it('renders the real console on /app/platform for a platform admin', async () => {
    H.pathname = '/app/platform';
    H.isPlatformAdmin = true;
    renderApp();
    await waitFor(() => expect(screen.getByText(t.platform.inviteTitle)).toBeDefined());
    expect(screen.queryByText(t.platform.notAvailable)).toBeNull();
    expect(H.invitesCalls).toBeGreaterThan(0);
  });
});
