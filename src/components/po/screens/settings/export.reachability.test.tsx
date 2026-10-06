// @vitest-environment jsdom
/**
 * Export reachability for a platform admin in a venue they hold no membership
 * at (legal v0.3 E1, decision #49; manual QA question 15, PR #389).
 *
 * `getPlatformAdminVenue` gives them `roles: []`. Before #389 that hid the
 * export at three levels: the More row to Venue settings, the Venue settings
 * screen itself ("no rights"), and the card. `export.visibility.test.tsx`
 * pins the card; this file pins the two screens around it, so removing either
 * gate fix makes CI red instead of silently re-hiding the export:
 *
 *  - More shows "Venue settings" to a platform admin with roles [], and still
 *    hides it from a staff member who is not one;
 *  - VenueSettings keeps its "no rights" note for roles [] but mounts the
 *    working "Export everything" button for a platform admin — and nothing for
 *    a roles [] user who is not one (external crew / organizer).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const A = '018f3a2e-0000-7000-8000-00000000000a';

const H = vi.hoisted(() => ({
  roles: [] as string[],
  platformAdmin: true,
}));

vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: A, venueName: 'QA Venue', roles: H.roles }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.platformAdmin,
  usePoVenueSettings: () => ({ data: undefined, isLoading: false, isError: false }),
  usePoProfile: () => ({ isLoading: false, data: undefined }),
  usePoSubscription: () => ({ data: undefined }),
  usePoCanManageTemplates: () => false,
  usePoGuestRequests: () => ({ data: [] }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoUpdateVenueSettings: () => ({ mutate: vi.fn(), isPending: false, isError: false, isSuccess: false, error: null }),
}));
vi.mock('@/features/export/actions', () => ({ exportVenueData: vi.fn() }));
vi.mock('../../app-shell-data', () => ({ useIsDemoAccount: () => false, useIsDemoVenue: () => false }));
vi.mock('../../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
  usePo: () => ({
    statsVenues: [],
    isMobile: false,
    myVenues: [{ venueId: A, venueName: 'QA Venue', roles: H.roles }],
    activeVenueId: A,
    switchToVenue: vi.fn(),
  }),
}));
vi.mock('../guests', () => ({ armRegularsFilter: vi.fn() }));
vi.mock('../../phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: () => null,
  phoneCountryOf: () => Promise.resolve(null),
}));

const { Meer } = await import('../settings');
const { VenueSettings } = await import('./venue');

afterEach(() => {
  cleanup();
  H.roles = [];
  H.platformAdmin = true;
});

describe('More → Venue settings row', () => {
  it('shows for a platform admin with roles []', () => {
    render(<Meer />);
    expect(screen.getByText(t.settings.more.venueSettingsTitle)).toBeInTheDocument();
  });

  it('stays hidden for staff who is not a platform admin', () => {
    H.roles = ['staff'];
    H.platformAdmin = false;
    render(<Meer />);
    expect(screen.queryByText(t.settings.more.venueSettingsTitle)).toBeNull();
  });
});

describe('VenueSettings without settings rights', () => {
  it('keeps the no-rights note and mounts the export for a platform admin', () => {
    render(<VenueSettings />);
    expect(screen.getByText(t.settings.venue.viewNoRights)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: t.settings.export.everything })).toBeInTheDocument();
  });

  it('shows no export to a roles [] user who is not a platform admin', () => {
    H.platformAdmin = false;
    render(<VenueSettings />);
    expect(screen.getByText(t.settings.venue.viewNoRights)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t.settings.export.everything })).toBeNull();
  });
});
