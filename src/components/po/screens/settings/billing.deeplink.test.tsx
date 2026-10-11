// @vitest-environment jsdom
/**
 * Billing deep link (z8uq9m49k4): a billing mail's button opens
 * /app/billing?venue=<company>. For ANOTHER company the user belongs to, the
 * screen explains and offers "Switch to {company}" (never a silent switch);
 * the switch goes through the shell's switchToVenue (switchActiveVenueAction:
 * membership check + platform_access_log) and lands back on /app/billing.
 * The active company, a company the user is no member of, or junk all show
 * the active company's billing, so the link never reveals another company.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PoSubscription } from '@/features/po/adapters';

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const STRANGER = 'aa000000-0000-7000-8000-0000000000ff';

const H = vi.hoisted(() => ({
  switchToVenue: vi.fn(),
  native: false,
  activeVenueId: 'aa000000-0000-7000-8000-000000000001',
}));

vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoSubscription: () => ({
    isLoading: false,
    isError: false,
    data: {
      plan: 'Pro',
      status: 'trialing',
      billingInterval: null,
      renews: '—',
      events: 'Unlimited',
      venueLabel: 'Club Vesper',
      stripeLinked: false,
      trialEndsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    } satisfies PoSubscription,
  }),
  usePoBillingPrices: () => ({ isLoading: false, data: null }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoBillingCheckout: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
  usePoBillingPortal: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
}));
vi.mock('../../context', () => ({
  useNav: () => ({ back: vi.fn(), push: vi.fn() }),
  usePo: () => ({
    activeVenueId: H.activeVenueId,
    myVenues: [
      { venueId: VESPER, venueName: 'Club Vesper', roles: ['admin'] },
      { venueId: MARKTZAAL, venueName: 'De Marktzaal', roles: ['admin'] },
    ],
    switchToVenue: H.switchToVenue,
  }),
}));

const { Billing } = await import('./billing');

afterEach(() => {
  cleanup();
  H.switchToVenue.mockReset();
  H.native = false;
  H.activeVenueId = VESPER;
});

describe('Billing ?venue= deep link', () => {
  it('another company of mine: explain + "Switch to", no billing body, no silent switch', () => {
    render(<Billing venueId={MARKTZAAL} />);
    expect(screen.getByTestId('billing-other-company')).toBeInTheDocument();
    expect(screen.getByText('Billing for De Marktzaal')).toBeInTheDocument();
    expect(
      screen.getByText("You're working in Club Vesper right now. Switch to see the billing for De Marktzaal.")
    ).toBeInTheDocument();
    expect(H.switchToVenue).not.toHaveBeenCalled();
  });

  it('the button switches through switchToVenue and lands on /app/billing (no query)', () => {
    render(<Billing venueId={MARKTZAAL} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch to De Marktzaal/ }));
    expect(H.switchToVenue).toHaveBeenCalledWith(MARKTZAAL, '/app/billing');
  });

  it.each([
    ['the active company', VESPER],
    ['a company I am no member of', STRANGER],
    ['junk', 'not-a-uuid'],
    ['nothing', undefined],
  ])('%s: the active company\'s billing, nothing about another company', (_label, venueId) => {
    render(<Billing venueId={venueId} />);
    expect(screen.queryByTestId('billing-other-company')).toBeNull();
    expect(screen.queryByText(/De Marktzaal/)).toBeNull();
    expect(screen.getByText('Pro')).toBeInTheDocument();
  });

  it('active company not among my memberships (a platform admin who entered it): no empty "working in  right now"', () => {
    H.activeVenueId = STRANGER;
    render(<Billing venueId={MARKTZAAL} />);
    expect(screen.getByText('Switch to see the billing for De Marktzaal.')).toBeInTheDocument();
    expect(screen.queryByText(/working in/)).toBeNull();
    expect(screen.getByRole('button', { name: /Switch to De Marktzaal/ })).toBeInTheDocument();
  });

  it('native shell: the switch card carries no purchase copy', () => {
    H.native = true;
    const { container } = render(<Billing venueId={MARKTZAAL} />);
    expect(container.textContent).not.toMatch(/€|\/ ?month|\/ ?year|payment|iDEAL|SEPA|checkout|portal|reactivate|upgrade|on the web/i);
  });
});
