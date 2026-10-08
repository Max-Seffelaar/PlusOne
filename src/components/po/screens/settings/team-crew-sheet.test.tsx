// @vitest-environment jsdom
/**
 * Team → External crew → Manage (z8uq9m2yvp): an admin opens a sheet per crew
 * member with every event they're crew on; per event the guest quota saves
 * through setEventUserQuota and "Remove from crew" asks first, then calls
 * removeOrganizer. Non-admins never get the Manage entry (crew writes are
 * admin-only, RLS is the boundary). UX tests; the actions have their own.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';

const stub = () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null, variables: undefined });

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  crew: [] as unknown[],
  setQuota: {} as Record<string, { mutate: ReturnType<typeof vi.fn> }>,
  removeCrew: {} as Record<string, { mutate: ReturnType<typeof vi.fn> }>,
  mutations: {} as Record<string, unknown>,
}));

vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => false, useIsDemoVenue: () => false }));
vi.mock('../../context', () => ({ useNav: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('../../shell', () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div data-testid="sheet">{children}</div>,
  BottomBar: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: H.roles, venueName: 'Venue A', venueId: 'v1' }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoTeam: () => ({ data: [] }),
  usePoInvites: () => ({ data: [] }),
  usePoVenueCrew: () => ({ data: H.crew }),
  usePoEvents: () => ({ data: [] }),
  useBillingBlocked: () => ({ blocked: false }),
}));
vi.mock('@/features/po/mutations', () => {
  const names = [
    'usePoInviteUser', 'usePoInviteExternalCrew', 'usePoRevokeInvite', 'usePoResendInvite',
    'usePoResendCrewInvite', 'usePoUpdateMemberRoles', 'usePoRemoveMember',
  ];
  return {
    ...Object.fromEntries(names.map((n) => [n, () => (H.mutations[n] ??= stub())])),
    usePoSetCrewQuota: (eventId: string) => (H.setQuota[eventId] ??= stub()),
    usePoRemoveCrew: (eventId: string) => (H.removeCrew[eventId] ??= stub()),
  };
});
vi.mock('../../mfa-gate', () => ({ useMfaGate: () => ({ guard: vi.fn(), sheet: null }), isAal2Error: () => false }));

const { Gebruikers } = await import('./team');
const { CrewManageSheet } = await import('./team-crew-sheet');

const robin = {
  userId: 'u-robin',
  name: 'Robin Crew',
  email: 'robin@crew.test',
  eventsLabel: 'Friday +1',
  eventCount: 2,
  hasAccepted: true,
  events: [
    { eventId: 'e-fri', name: 'Friday', quota: 4 },
    { eventId: 'e-sat', name: 'Saturday', quota: 0 },
  ],
};

afterEach(() => {
  cleanup();
  H.roles = ['admin'];
  H.crew = [];
  H.setQuota = {};
  H.removeCrew = {};
  H.mutations = {};
});

describe('Team → External crew → Manage', () => {
  it('an admin gets a Manage button per crew member that opens the sheet', () => {
    H.crew = [robin];
    render(<Gebruikers />);
    fireEvent.click(screen.getByRole('button', { name: fmt(t.settings.team.manageAria, { name: 'Robin Crew' }) }));
    const sheet = screen.getByTestId('sheet');
    expect(within(sheet).getByText('Robin Crew')).toBeInTheDocument();
    expect(within(sheet).getAllByTestId('crew-event-row')).toHaveLength(2);
  });

  it.each([['user_manager'], ['finance']])('a %s sees the crew list but no Manage', (role) => {
    H.roles = [role];
    H.crew = [robin];
    render(<Gebruikers />);
    expect(screen.getByText('Robin Crew')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: fmt(t.settings.team.manageAria, { name: 'Robin Crew' }) })).toBeNull();
  });
});

describe('CrewManageSheet', () => {
  it('lists every event with its quota; changing one and Save writes only that event', () => {
    H.crew = [robin];
    render(<CrewManageSheet userId="u-robin" onClose={vi.fn()} />);
    const [fri] = screen.getAllByTestId('crew-event-row');
    expect(within(fri).getByText('Friday')).toBeInTheDocument();
    expect(within(fri).getByText('4')).toBeInTheDocument();
    expect(within(fri).queryByRole('button', { name: t.events.crew.save })).toBeNull();
    fireEvent.click(within(fri).getByRole('button', { name: t.events.crew.quotaMore }));
    fireEvent.click(within(fri).getByRole('button', { name: t.events.crew.save }));
    expect(H.setQuota['e-fri'].mutate).toHaveBeenCalledWith({ eventId: 'e-fri', userId: 'u-robin', quota: 5 });
    expect(H.setQuota['e-sat'].mutate).not.toHaveBeenCalled();
  });

  it('Remove from crew asks first; Cancel keeps them, confirming removes only that event', () => {
    H.crew = [robin];
    render(<CrewManageSheet userId="u-robin" onClose={vi.fn()} />);
    const [, sat] = screen.getAllByTestId('crew-event-row');
    fireEvent.click(within(sat).getByRole('button', { name: t.settings.team.crewRemove }));
    expect(within(sat).getByText(fmt(t.settings.team.crewRemoveConfirm, { name: 'Robin Crew', event: 'Saturday' }))).toBeInTheDocument();
    expect(H.removeCrew['e-sat'].mutate).not.toHaveBeenCalled();
    fireEvent.click(within(sat).getByRole('button', { name: t.settings.common.cancel }));
    expect(within(sat).queryByText(fmt(t.settings.team.crewRemoveConfirm, { name: 'Robin Crew', event: 'Saturday' }))).toBeNull();
    fireEvent.click(within(sat).getByRole('button', { name: t.settings.team.crewRemove }));
    fireEvent.click(within(sat).getByRole('button', { name: t.settings.team.crewRemoveConfirmBtn }));
    expect(H.removeCrew['e-sat'].mutate).toHaveBeenCalledWith({ eventId: 'e-sat', userId: 'u-robin' });
    expect(H.removeCrew['e-fri'].mutate).not.toHaveBeenCalled();
  });

  it('once they are on no crew here any more, the sheet says so', () => {
    H.crew = [];
    render(<CrewManageSheet userId="u-robin" onClose={vi.fn()} />);
    expect(screen.getByText(t.settings.team.crewSheetGone)).toBeInTheDocument();
  });
});
