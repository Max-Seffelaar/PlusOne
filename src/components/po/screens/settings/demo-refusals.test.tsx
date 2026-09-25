// @vitest-environment jsdom
/**
 * Store-review demo account (86ey6bfug): every entry point to an action the
 * demo account is refused shows the refusal UPFRONT — a disabled entry plus the
 * catalogue note — instead of a form that only fails on submit (guideline 2.1).
 * A normal admin sees the unchanged entry. UX only: the server actions and DB
 * guards are covered by their own tests and are untouched here.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';

const A = '018f3a2e-0000-7000-8000-00000000000a';

const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, variables: undefined });

const H = vi.hoisted(() => ({
  settings: {
    name: 'Venue A',
    retentionMonths: 12,
    defaultPersonalQuota: 0,
    allowUncheck: true,
    companyName: '',
    kvkNumber: '',
    vatNumber: '',
    financeEmail: '',
    addressLine: '',
    postalCode: '',
    city: '',
    country: 'NL',
    website: '',
  },
  demo: false,
  push: vi.fn(),
  mutations: {} as Record<string, { mutate: ReturnType<typeof vi.fn> }>,
}));

vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => H.demo, useIsDemoVenue: () => H.demo }));
vi.mock('../../context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn() }),
  usePo: () => ({ myVenues: [{ venueId: A, venueName: 'Venue A', roles: ['admin'] }], activeVenueId: A, switchToVenue: vi.fn() }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'], venueName: 'Venue A' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoVenueSettings: () => ({ data: H.settings, isLoading: false, isError: false }),
  usePoTeam: () => ({ data: [] }),
  usePoInvites: () => ({
    data: [{ id: 'inv-1', email: 'x@example.com', status: 'pending', rolesLabel: 'Staff', sentAt: 'today' }],
  }),
  usePoVenueCrew: () => ({ data: [{ userId: 'crew-1', name: 'Crew One', eventsLabel: 'E', hasAccepted: false }] }),
  usePoEvents: () => ({ data: [] }),
  useBillingBlocked: () => ({ blocked: false }),
  usePoProfile: () => ({
    isLoading: false,
    data: { firstName: 'A', lastName: 'B', phone: '', email: 'me@example.com', name: 'A B', roleLabel: 'Admin', mfaRequired: false },
  }),
  usePoSessions: () => ({ data: [] }),
}));
vi.mock('@/features/po/mutations', () => {
  const names = [
    'usePoUpdateVenueSettings',
    'usePoInviteUser',
    'usePoInviteExternalCrew',
    'usePoRevokeInvite',
    'usePoResendInvite',
    'usePoResendCrewInvite',
    'usePoUpdateMemberRoles',
    'usePoRemoveMember',
    'usePoUpdateProfile',
    'usePoUpdateEmail',
    'usePoRevokeOwnSession',
  ];
  return Object.fromEntries(names.map((n) => [n, () => (H.mutations[n] ??= stub())]));
});
vi.mock('../../mfa-gate', () => ({
  useMfaGate: () => ({ guard: vi.fn(), sheet: null }),
  isAal2Error: () => false,
  PoMfaSheet: () => null,
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { mfa: { listFactors: () => Promise.resolve({ data: { all: [] } }) } } }),
}));
vi.mock('../../phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: () => null,
  phoneCountryOf: () => Promise.resolve(null),
}));

const { VenueSwitch, VenueSettings } = await import('./venue');
const { Gebruikers } = await import('./team');
const { Profile } = await import('./profile');

afterEach(() => {
  cleanup();
  H.push.mockClear();
  H.mutations = {};
});

const btn = (label: string) => screen.getByRole('button', { name: new RegExp(label) });

describe('venue switcher "New venue"', () => {
  it.each([['VenueSwitch', VenueSwitch], ['VenueSettings', VenueSettings]] as const)('%s: demo sees the refusal, the entry is inert', (_n, Screen) => {
    H.demo = true;
    render(<Screen />);
    expect(screen.getByText(t.auth.demoNoVenues)).toBeInTheDocument();
    const add = btn(t.settings.venueSwitch.addVenue);
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(H.push).not.toHaveBeenCalledWith('venuecreate');
  });

  it.each([['VenueSwitch', VenueSwitch], ['VenueSettings', VenueSettings]] as const)('%s: an admin opens the create form as before', (_n, Screen) => {
    H.demo = false;
    render(<Screen />);
    expect(screen.queryByText(t.auth.demoNoVenues)).toBeNull();
    fireEvent.click(btn(t.settings.venueSwitch.addVenue));
    expect(H.push).toHaveBeenCalledWith('venuecreate');
  });
});

describe('team invite + resend', () => {
  it('demo: invite is disabled with the note, no form opens, resends are inert', () => {
    H.demo = true;
    render(<Gebruikers />);
    expect(screen.getByText(t.auth.demoNoInvites)).toBeInTheDocument();
    const invite = btn(t.settings.team.inviteCta);
    expect(invite).toBeDisabled();
    fireEvent.click(invite);
    expect(screen.queryByText(t.settings.team.chooseTitle)).toBeNull();
    const resends = screen.getAllByRole('button', { name: t.settings.team.resend });
    expect(resends).toHaveLength(2);
    for (const r of resends) {
      expect(r).toBeDisabled();
      fireEvent.click(r);
    }
    expect(H.mutations.usePoResendInvite?.mutate).not.toHaveBeenCalled();
    expect(H.mutations.usePoResendCrewInvite?.mutate).not.toHaveBeenCalled();
  });

  it('admin: invite opens the Team/Crew chooser and resend fires', () => {
    H.demo = false;
    render(<Gebruikers />);
    expect(screen.queryByText(t.auth.demoNoInvites)).toBeNull();
    const [resendCrew] = screen.getAllByRole('button', { name: t.settings.team.resend });
    fireEvent.click(resendCrew);
    expect(H.mutations.usePoResendCrewInvite?.mutate).toHaveBeenCalledWith('crew-1');
    fireEvent.click(btn(t.settings.team.inviteCta));
    expect(screen.getByText(t.settings.team.chooseTitle)).toBeInTheDocument();
  });
});

describe('profile e-mail change', () => {
  it('demo: e-mail is read-only with the note, no change button', async () => {
    H.demo = true;
    render(<Profile />);
    expect(await screen.findByText(t.auth.demoNoEmailChange)).toBeInTheDocument();
    expect(screen.getByText('me@example.com')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('me@example.com')).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(t.settings.profile.changeEmail) })).toBeNull();
  });

  it('admin: the e-mail is editable and a change offers the button', async () => {
    H.demo = false;
    render(<Profile />);
    const input = await screen.findByDisplayValue('me@example.com');
    expect(screen.queryByText(t.auth.demoNoEmailChange)).toBeNull();
    fireEvent.change(input, { target: { value: 'new@example.com' } });
    fireEvent.click(btn(t.settings.profile.changeEmail));
    expect(H.mutations.usePoUpdateEmail?.mutate).toHaveBeenCalledWith('new@example.com');
  });
});
