// @vitest-environment jsdom
/**
 * Store-review demo account, round 8 (86ey6bfug). Round 7's leaf tests mocked
 * `useIsDemoAccount` itself, so nothing proved the demo signal actually reaches
 * the screens through the providers the /app layout mounts — and on prod the
 * demo account still reached "New venue", the team invite and the crew invite.
 *
 * This suite mocks NO demo hook: it mounts the real `AppShellDataProvider` and
 * the real `PoLiveProvider` (exactly what src/app/app/layout.tsx renders) and
 * the real screen components the app-screens switch renders for venueswitch,
 * venuesettings, venuecreate, gebruikers and crew. Only data/mutation hooks and
 * navigation are stubbed. Each demo signal is proven on its own:
 *   - the layout flag alone (`demoAccount`),
 *   - the live identity's user id alone (flag lost),
 *   - a non-demo user acting in the demo venue (platform admin on support):
 *     membership actions refused, "New venue" still theirs.
 * A normal admin in a normal venue sees every form as before.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { DEMO_USER_ID, DEMO_VENUE_ID } from '@/features/auth/demo-account';

const OTHER_USER = '018f3a2e-0000-7000-8000-0000000000b1';
const NORMAL_VENUE = '018f3a2e-0000-7000-8000-00000000000a';

const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, variables: undefined });

const H = vi.hoisted(() => ({
  push: vi.fn(),
  createVenueAction: vi.fn(),
  mutations: {} as Record<string, { mutate: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@/lib/observability/sentry-client', () => ({ setUser: vi.fn(), setTag: vi.fn() }));
vi.mock('./context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn(), replace: vi.fn() }),
  usePo: () => ({
    myVenues: [{ venueId: NORMAL_VENUE, venueName: 'Venue A', roles: ['admin'] }],
    activeVenueId: NORMAL_VENUE,
    switchToVenue: vi.fn(),
  }),
}));
vi.mock('./shell', async (orig) => ({
  ...(await orig<typeof import('./shell')>()),
  Sheet: ({ children }: { children: ReactNode }) => <div data-testid="sheet">{children}</div>,
}));
vi.mock('@/features/venues/actions', () => ({ createVenueAction: H.createVenueAction, switchActiveVenueAction: vi.fn() }));
vi.mock('@/features/po/hooks', () => ({
  usePoVenueSettings: () => ({
    data: {
      name: 'Venue A', retentionMonths: 12, defaultPersonalQuota: 0, allowUncheck: true, companyName: '',
      kvkNumber: '', vatNumber: '', financeEmail: '', addressLine: '', postalCode: '', city: '', country: 'NL', website: '',
    },
    isLoading: false,
    isError: false,
  }),
  usePoTeam: () => ({ data: [] }),
  usePoInvites: () => ({ data: [{ id: 'inv-1', email: 'x@example.com', status: 'pending', rolesLabel: 'Staff', sentAt: 'today' }] }),
  usePoVenueCrew: () => ({ data: [{ userId: 'crew-1', name: 'Crew One', eventsLabel: 'E', hasAccepted: false }] }),
  usePoEvents: () => ({ data: [] }),
  useBillingBlocked: () => ({ blocked: false }),
  usePoCrew: () => ({ data: [], isLoading: false, isError: false }),
  usePoAssignableCrew: () => ({ data: [], isLoading: false }),
  usePoEvent: () => ({ event: { name: 'Event' } }),
  usePoEventForEdit: () => ({ data: { defaultMemberQuota: 2 } }),
}));
vi.mock('@/features/po/mutations', () => {
  const names = [
    'usePoUpdateVenueSettings', 'usePoInviteUser', 'usePoInviteExternalCrew', 'usePoRevokeInvite', 'usePoResendInvite',
    'usePoResendCrewInvite', 'usePoUpdateMemberRoles', 'usePoRemoveMember', 'usePoAssignCrew', 'usePoSetCrewQuota', 'usePoRemoveCrew',
  ];
  return Object.fromEntries(names.map((n) => [n, () => (H.mutations[n] ??= stub())]));
});
vi.mock('./mfa-gate', () => ({ useMfaGate: () => ({ guard: vi.fn(), sheet: null }), isAal2Error: () => false }));

const { AppShellDataProvider } = await import('./app-shell-data');
const { PoLiveProvider } = await import('@/features/po/PoLiveProvider');
const { VenueSwitch, VenueSettings, Gebruikers } = await import('./screens/settings');
const { VenueCreate } = await import('./screens/onboarding');
const { Crew } = await import('./screens/events');

afterEach(() => {
  cleanup();
  H.push.mockClear();
  H.createVenueAction.mockClear();
  H.mutations = {};
});

type Who = { demoAccount?: boolean; userId: string; venueId: string };

/** The provider pair src/app/app/layout.tsx mounts, with nothing mocked. */
function mount(who: Who, ui: ReactNode): void {
  render(
    <PoLiveProvider identity={{ userId: who.userId, venueId: who.venueId, venueName: 'V', roles: ['admin', 'doorhost'] }}>
      <AppShellDataProvider
        value={{
          myVenues: [{ venueId: who.venueId, venueName: 'V', roles: ['admin', 'doorhost'] }],
          activeVenueId: who.venueId,
          serverHint: true,
          ...(who.demoAccount === undefined ? {} : { demoAccount: who.demoAccount }),
        }}
      >
        {ui}
      </AppShellDataProvider>
    </PoLiveProvider>,
  );
}

const byName = (label: string) => screen.getAllByRole('button', { name: new RegExp(label) });

const DEMO_SIGNALS: [string, Who][] = [
  ['layout flag alone', { demoAccount: true, userId: OTHER_USER, venueId: NORMAL_VENUE }],
  ['identity user id alone (flag lost)', { userId: DEMO_USER_ID, venueId: DEMO_VENUE_ID }],
  ['identity user id with the flag explicitly false', { demoAccount: false, userId: DEMO_USER_ID, venueId: DEMO_VENUE_ID }],
];
const NORMAL_ADMIN: Who = { demoAccount: false, userId: OTHER_USER, venueId: NORMAL_VENUE };
const SUPPORT_IN_DEMO_VENUE: Who = { demoAccount: false, userId: OTHER_USER, venueId: DEMO_VENUE_ID };

describe.each(DEMO_SIGNALS)('demo account via %s', (_label, who) => {
  it.each([
    ['venueswitch', () => <VenueSwitch />],
    ['venuesettings', () => <VenueSettings />],
  ] as const)('%s: "New venue" is inert with the note, never navigates', (_s, ui) => {
    mount(who, ui());
    expect(screen.getByText(t.auth.demoNoVenues)).toBeInTheDocument();
    for (const b of byName(t.settings.venueSwitch.addVenue)) {
      expect(b).toBeDisabled();
      fireEvent.click(b);
    }
    // The header "+" on the switcher is disabled too.
    for (const b of screen.getAllByRole('button')) if (b.hasAttribute('disabled')) fireEvent.click(b);
    expect(H.push).not.toHaveBeenCalledWith('venuecreate');
  });

  it('venuecreate (deep link): note only, no form', () => {
    mount(who, <VenueCreate />);
    expect(screen.getByText(t.auth.demoNoVenues)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(t.onboarding.venueCreate.companyNamePlaceholder)).toBeNull();
    expect(H.createVenueAction).not.toHaveBeenCalled();
  });

  it('gebruikers: invite inert with the note, no chooser/form, resends inert', () => {
    mount(who, <Gebruikers />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    for (const b of byName(t.settings.team.inviteCta)) {
      expect(b).toBeDisabled();
      fireEvent.click(b);
    }
    expect(screen.queryByText(t.settings.team.chooseTitle)).toBeNull();
    for (const r of screen.getAllByRole('button', { name: t.settings.team.resend })) {
      expect(r).toBeDisabled();
      fireEvent.click(r);
    }
    expect(H.mutations.usePoResendInvite?.mutate).not.toHaveBeenCalled();
    expect(H.mutations.usePoResendCrewInvite?.mutate).not.toHaveBeenCalled();
  });

  it('crew: "Add crew" inert with the note, no sheet', () => {
    mount(who, <Crew eventId="e1" />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    const [add] = byName(t.events.crew.addHeading);
    expect(add).toBeDisabled();
    fireEvent.click(add!);
    expect(screen.queryByTestId('sheet')).toBeNull();
    expect(screen.queryByPlaceholderText(t.events.crew.invitePlaceholder)).toBeNull();
  });
});

describe('a non-demo admin acting in the demo venue (platform support)', () => {
  it('team invite and crew add are refused upfront (the DB refuses new members there)', () => {
    mount(SUPPORT_IN_DEMO_VENUE, <Gebruikers />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    cleanup();
    mount(SUPPORT_IN_DEMO_VENUE, <Crew eventId="e1" />);
    expect(byName(t.events.crew.addHeading)[0]).toBeDisabled();
  });

  it('"New venue" stays theirs: it is an account action, not a demo-venue one', () => {
    mount(SUPPORT_IN_DEMO_VENUE, <VenueSwitch />);
    expect(screen.queryByText(t.auth.demoNoVenues)).toBeNull();
    fireEvent.click(byName(t.settings.venueSwitch.addVenue)[0]!);
    expect(H.push).toHaveBeenCalledWith('venuecreate');
  });
});

describe('a normal admin in a normal venue: nothing changes', () => {
  it('New venue navigates, VenueCreate shows the form', () => {
    mount(NORMAL_ADMIN, <VenueSettings />);
    expect(screen.queryByText(t.auth.demoNoVenues)).toBeNull();
    fireEvent.click(byName(t.settings.venueSwitch.addVenue)[0]!);
    expect(H.push).toHaveBeenCalledWith('venuecreate');
    cleanup();
    mount(NORMAL_ADMIN, <VenueCreate />);
    expect(screen.getByPlaceholderText(t.onboarding.venueCreate.companyNamePlaceholder)).toBeInTheDocument();
  });

  it('team invite opens the chooser and resend fires', () => {
    mount(NORMAL_ADMIN, <Gebruikers />);
    expect(screen.queryByText(t.auth.demoNoInvites)).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: t.settings.team.resend })[0]!);
    expect(H.mutations.usePoResendCrewInvite?.mutate).toHaveBeenCalledWith('crew-1');
    fireEvent.click(byName(t.settings.team.inviteCta)[0]!);
    expect(screen.getByText(t.settings.team.chooseTitle)).toBeInTheDocument();
  });

  it('crew add opens the sheet with the invite form', () => {
    mount(NORMAL_ADMIN, <Crew eventId="e1" />);
    fireEvent.click(byName(t.events.crew.addHeading)[0]!);
    expect(screen.getByPlaceholderText(t.events.crew.invitePlaceholder)).toBeInTheDocument();
  });
});
