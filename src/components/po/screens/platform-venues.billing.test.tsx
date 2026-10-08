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
import type { PlatformBilling, PlatformVenue } from '@/features/po/adapters';

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
  billing: null as unknown,
  trialMutate: vi.fn(),
  compedMutate: vi.fn(),
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
  usePo: () => ({ switchToVenue: vi.fn() }),
}));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => true,
  usePoPlatformVenues: () => ({ data: [VENUE], isLoading: false, isError: false }),
  usePoPlatformVenuesCount: () => ({ data: 1 }),
  usePoPlatformBilling: () => ({ data: new Map([[VENUE.venueId, H.billing]]), isError: false }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoSetVenueTrialEnd: () => ({ mutate: H.trialMutate, reset: vi.fn(), isPending: false, error: null }),
  usePoSetVenueComped: () => ({ mutate: H.compedMutate, reset: vi.fn(), isPending: false, error: null }),
}));

const { PlatformVenues } = await import('./platform-venues');

const inDays = (d: number): string => new Date(Date.now() + d * 86_400_000).toISOString();
const trialing = (over: Partial<PlatformBilling> = {}): PlatformBilling => ({
  venueId: VENUE.venueId,
  status: 'trialing',
  trialEndsAt: inDays(9),
  stripeLinked: false,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Platform > Companies — trial / always free', () => {
  it('a running trial reads "Trial until <date>" and is not always free', () => {
    H.billing = trialing();
    render(<PlatformVenues />);
    expect(screen.getByText(/^Trial until \d+ \w+$/)).toBeInTheDocument();
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });

  it('a lapsed trial reads "Trial ended <date>"', () => {
    H.billing = trialing({ trialEndsAt: inDays(-3) });
    render(<PlatformVenues />);
    expect(screen.getByText(/^Trial ended \d+ \w+$/)).toBeInTheDocument();
  });

  it('switching "Always free" on sets comped', () => {
    H.billing = trialing();
    render(<PlatformVenues />);
    fireEvent.click(screen.getByRole('switch'));
    expect(H.compedMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, comped: true });
  });

  it('an always-free company shows it, and switching off un-comps it', () => {
    H.billing = trialing({ status: 'comped', trialEndsAt: null });
    render(<PlatformVenues />);
    expect(screen.getAllByText(t.platform.billingAlwaysFree).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('switch'));
    expect(H.compedMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, comped: false });
  });

  it('"Set trial end" sends the picked calendar day', () => {
    H.billing = trialing();
    render(<PlatformVenues />);
    const input = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-12-31' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.platform.billingSetTrial) }));
    expect(H.trialMutate).toHaveBeenCalledWith({ venueId: VENUE.venueId, trialEndsOn: '2026-12-31' });
  });

  it('a Stripe-linked company has no controls, only the note', () => {
    H.billing = trialing({ status: 'active', trialEndsAt: null, stripeLinked: true });
    render(<PlatformVenues />);
    expect(screen.getByText(t.platform.billingStripeManaged)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });
});
