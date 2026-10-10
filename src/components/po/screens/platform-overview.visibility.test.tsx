// @vitest-environment jsdom
/**
 * Platform > Overview visibility (z8uq9m2ybj).
 *
 * Same contract as the other platform-*.visibility tests: a non-platform-admin
 * on /app/platform/overview sees the flat "not available" state and fires NO
 * read (the RPCs would raise 42501 — RLS is the boundary, this gate only keeps
 * the doomed call from happening). Plus the store-tax seam: inside the native
 * shell the revenue card is not rendered and the Stripe prices are never
 * requested; in the browser MRR reads "—" without prices (the stub).
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  isPlatformAdmin: false,
  native: false,
  countsCalls: 0,
  funnelCalls: 0,
  usageCalls: 0,
  pricesCalls: 0,
  prices: null as unknown,
  paidUnknown: 0,
}));

vi.mock('../context', () => ({
  useNav: () => ({ push: vi.fn(), back: vi.fn(), canGoBack: false }),
}));
vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('@/features/po/hooks', () => ({
  usePoIsPlatformAdmin: () => H.isPlatformAdmin,
  usePoPlatformSubscriptionCounts: () => {
    H.countsCalls += 1;
    return {
      data: {
        total: 4, trialing: 3, trialingNoPayment: 2, trialingPaymentSetUp: 1, trialLapsed: 0, paidMonthly: 0, paidYearly: 0, paidUnknown: H.paidUnknown,
        pastDue: 0, canceled: 0, comped: 1, noSubscription: 0,
      },
      isError: false,
    };
  },
  usePoPlatformTrialFunnel: () => {
    H.funnelCalls += 1;
    return {
      data: { ending7d: 0, ended30d: 0, converted30d: 0, ended90d: 0, converted90d: 0, canceled30d: 0 },
      isError: false,
    };
  },
  usePoPlatformUsage: () => {
    H.usageCalls += 1;
    return { data: { activeCompanies: 0, events: 0, checkIns: 0, dormantCompanies: 1 }, isError: false };
  },
  usePoBillingPrices: () => {
    H.pricesCalls += 1;
    return { data: H.prices, isSuccess: true };
  },
}));

const { PlatformOverview } = await import('./platform-overview');

afterEach(() => {
  cleanup();
  H.isPlatformAdmin = false;
  H.native = false;
  H.countsCalls = 0;
  H.funnelCalls = 0;
  H.usageCalls = 0;
  H.pricesCalls = 0;
  H.prices = null;
  H.paidUnknown = 0;
});

describe('Platform > Overview visibility (z8uq9m2ybj)', () => {
  it('shows "not available" and fires no read for a non-platform-admin', () => {
    render(<PlatformOverview />);
    expect(screen.getByText(t.platform.notAvailable)).toBeDefined();
    expect(H.countsCalls + H.funnelCalls + H.usageCalls + H.pricesCalls).toBe(0);
    expect(screen.queryByTestId('platform-overview-status')).toBeNull();
  });

  it('renders the numbers for a platform admin; MRR is "—" without Stripe prices', () => {
    H.isPlatformAdmin = true;
    render(<PlatformOverview />);
    expect(screen.queryByText(t.platform.notAvailable)).toBeNull();
    expect(screen.getByTestId('platform-overview-status')).toHaveTextContent(t.platform.overviewComped);
    const revenue = screen.getByTestId('platform-overview-revenue');
    expect(revenue).toHaveTextContent(`—${t.platform.overviewMrr}`);
    expect(screen.getByText(new RegExp(t.platform.overviewRevenueNoPrices))).toBeDefined();
  });

  it('shows trials without and with a payment set up as two tiles', () => {
    H.isPlatformAdmin = true;
    render(<PlatformOverview />);
    const status = screen.getByTestId('platform-overview-status');
    expect(status).toHaveTextContent(`2${t.platform.overviewTrialingNoPayment}`);
    expect(status).toHaveTextContent(`1${t.platform.overviewTrialingPaymentSetUp}`);
    // The bare "Trial" label is native-only (every running trial).
    expect(screen.queryByText(t.platform.overviewTrialing)).toBeNull();
    expect(screen.getByText(/Converted means it pays now, past due included\./)).toBeDefined();
  });

  it('inside the native shell: no payment tile, Trial shows every running trial', () => {
    H.isPlatformAdmin = true;
    H.native = true;
    render(<PlatformOverview />);
    const status = screen.getByTestId('platform-overview-status');
    expect(status).toHaveTextContent(`3${t.platform.overviewTrialing}`);
    expect(screen.queryByText(t.platform.overviewTrialingPaymentSetUp)).toBeNull();
    expect(screen.queryByText(t.platform.overviewTrialingNoPayment)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/payment/i);
  });

  it('computes MRR from our counts × the Stripe prices in the browser', () => {
    H.isPlatformAdmin = true;
    H.prices = { month: { interval: 'month', unitAmount: 4900, currency: 'eur' }, year: null };
    render(<PlatformOverview />);
    // 0 monthly payers in the mocked counts → €0, not "—": prices are known.
    expect(screen.getByTestId('platform-overview-revenue')).toHaveTextContent(`€0${t.platform.overviewMrr}`);
  });

  it('says how many paying companies with no known interval the amount leaves out', () => {
    H.isPlatformAdmin = true;
    H.paidUnknown = 3;
    H.prices = { month: { interval: 'month', unitAmount: 4900, currency: 'eur' }, year: null };
    render(<PlatformOverview />);
    expect(screen.getByText(/Leaves out 3 paying companies with no known interval\./)).toBeDefined();
  });

  it('hides the revenue card and never asks for prices inside the native shell', () => {
    H.isPlatformAdmin = true;
    H.native = true;
    render(<PlatformOverview />);
    expect(screen.queryByTestId('platform-overview-revenue')).toBeNull();
    expect(screen.queryByText(t.platform.overviewMrr)).toBeNull();
    expect(H.pricesCalls).toBe(0);
    expect(screen.getByTestId('platform-overview-usage')).toBeDefined();
  });
});
