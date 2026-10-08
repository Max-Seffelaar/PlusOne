// @vitest-environment jsdom
/**
 * Platform > Companies — trial management (Billing G). A platform admin sees
 * each company's billing state ("Trial until <date>", "Always free") and sets
 * it through the two mutations (set_venue_trial_end / set_venue_comped; the
 * RPCs are the boundary, proven in pgTAP platform_billing). A Stripe-linked
 * company gets the "change it in Stripe" note and no controls.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { t } from '@/lib/i18n';
import type { PlatformCompany, PlatformVenue } from '@/features/po/adapters';
import { companyStatusLabel } from './platform-company';

const VENUE: PlatformVenue = {
  venueId: 'aa000000-0000-7000-8000-000000000002',
  name: 'De Marktzaal',
  slug: 'de-marktzaal',
  memberCount: 1,
  eventCount: 0,
  subscriptionStatus: 'trialing',
  lastActivityAt: null,
};

const H = vi.hoisted(() => ({
  company: null as unknown,
  activeVenueId: 'aa000000-0000-7000-8000-000000000001',
  trialMutate: vi.fn(),
  compedMutate: vi.fn(),
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
  usePo: () => ({ switchToVenue: vi.fn() }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ userId: 'u1', venueId: H.activeVenueId, roles: [] }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => true,
  usePoPlatformVenues: () => ({ data: [VENUE], isLoading: false, isError: false }),
  usePoPlatformVenuesCount: () => ({ data: 1 }),
  // One read for the whole card (Platform R): the billing controls are
  // projected from the same PlatformCompany the Invites list renders.
  usePoPlatformCompanies: () => ({ data: new Map([[VENUE.venueId, H.company]]), isLoading: false, isError: false }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoSetVenueTrialEnd: () => ({ mutate: H.trialMutate, reset: vi.fn(), isPending: false, error: null }),
  usePoSetVenueComped: () => ({ mutate: H.compedMutate, reset: vi.fn(), isPending: false, error: null }),
}));

const { PlatformVenues } = await import('./platform-venues');

const inDays = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString();
const trialing = (over: Partial<PlatformCompany> = {}): PlatformCompany => ({
  venueId: VENUE.venueId,
  name: VENUE.name,
  status: 'trialing',
  interval: null,
  trialEndsAt: inDays(9),
  stripeLinked: false,
  ownerLastSignInAt: null,
  lastCheckInAt: null,
  eventCount: 0,
  lastEvent: null,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Platform > Companies — trial / always free', () => {
  it('a running trial shows the SAME status text as Invites, and is not always free', () => {
    H.company = trialing();
    render(<PlatformVenues />);
    expect(screen.getByText(companyStatusLabel(trialing()))).toBeInTheDocument();
    expect(screen.getByText(/^Trial · \d+ days left$/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('a lapsed trial reads "Trial ended"', () => {
    H.company = trialing({ trialEndsAt: inDays(-3) });
    render(<PlatformVenues />);
    expect(screen.getByText(t.platform.companyTrialEnded)).toBeInTheDocument();
  });

  it('switching "Always free" on sets comped', () => {
    H.company = trialing();
    render(<PlatformVenues />);
    fireEvent.click(screen.getByRole('switch'));
    expect(H.compedMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, comped: true });
  });

  it('an always-free company shows it, and switching off un-comps it', () => {
    H.company = trialing({ status: 'comped', trialEndsAt: null });
    render(<PlatformVenues />);
    expect(screen.getAllByText(t.platform.billingAlwaysFree).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch'));
    expect(H.compedMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, comped: false });
  });

  it('"Set trial end" sends the picked calendar day', () => {
    H.company = trialing();
    render(<PlatformVenues />);
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.platform.billingSetTrial) }));
    expect(H.trialMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, trialEndsOn: '2026-12-31' });
  });

  it('no Switch for the company that is already active (switching would do nothing)', () => {
    H.company = trialing();
    render(<PlatformVenues />);
    expect(screen.getByRole('button', { name: new RegExp(t.platform.venuesSwitchInto) })).toBeInTheDocument();
    cleanup();
    H.activeVenueId = VENUE.venueId;
    render(<PlatformVenues />);
    expect(screen.queryByRole('button', { name: new RegExp(t.platform.venuesSwitchInto) })).not.toBeInTheDocument();
    H.activeVenueId = 'aa000000-0000-7000-8000-000000000001';
  });

  it('a Stripe-linked company has no controls, only the note', () => {
    H.company = trialing({ status: 'active', trialEndsAt: null, stripeLinked: true });
    render(<PlatformVenues />);
    expect(screen.getByText(t.platform.billingStripeManaged)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});
