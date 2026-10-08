// @vitest-environment jsdom
/**
 * Store-tax seam (#32/#37) on the Billing screen and the soft-block banner.
 * In the native shell a member sees the plan, the status and the trial
 * countdown only: no price, no interval, no checkout/portal button, no payment
 * method, no "set up your payment" nudge and no pointer to the web (Apple
 * 3.1.1/3.1.3, Play payments policy) — and the price query never even runs.
 * The browser keeps all of it (Billing G: monthly/yearly with live Stripe
 * prices, "Price shown at checkout" when there are none), for admin AND
 * finance.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PoSubscription } from '@/features/po/adapters';
import type { BillingPrices } from '@/features/billing/plans';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  native: false,
  roles: ['admin'] as string[],
  sub: null as unknown,
  prices: null as unknown,
  pricesEnabled: [] as boolean[],
  checkout: vi.fn(async (_interval: string) => 'https://checkout.test'),
}));

vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: H.roles }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoSubscription: () => ({ isLoading: false, isError: false, data: H.sub }),
  usePoBillingPrices: (opts?: { enabled?: boolean }) => {
    H.pricesEnabled.push(opts?.enabled ?? true);
    return { isLoading: false, data: opts?.enabled === false ? undefined : H.prices };
  },
}));
vi.mock('@/features/po/mutations', () => ({
  usePoBillingCheckout: () => ({ isPending: false, error: null, mutateAsync: H.checkout }),
  usePoBillingPortal: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
}));
vi.mock('../../context', () => ({ useNav: () => ({ back: vi.fn(), push: vi.fn() }) }));

const { Billing } = await import('./billing');
const { BillingLockNote } = await import('../../kit');

const base: PoSubscription = {
  plan: 'Pro',
  status: 'trialing',
  billingInterval: null,
  renews: '—',
  events: 'Unlimited',
  venueLabel: 'Club Test',
  stripeLinked: false,
  trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
};

const PRICES: BillingPrices = {
  month: { interval: 'month', unitAmount: 4900, currency: 'eur' },
  year: { interval: 'year', unitAmount: 47040, currency: 'eur' },
};

/** Anything a store reviewer would read as a price or a payment call to action. */
const PURCHASE_COPY = /€|\/ ?month|\/ ?year|monthly|yearly|payment|iDEAL|SEPA|card|checkout|portal|reactivate|on the web/i;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  H.native = false;
  H.roles = ['admin'];
  H.prices = null;
  H.pricesEnabled = [];
});

describe('Billing screen — native shell', () => {
  it.each<Partial<PoSubscription>>([
    { status: 'trialing' },
    { status: 'trialing', trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() },
    { status: 'active', stripeLinked: true, billingInterval: 'year', trialEndsAt: null },
    { status: 'past_due', stripeLinked: true, billingInterval: 'month', trialEndsAt: null },
    { status: 'canceled', trialEndsAt: null },
    { status: 'comped', trialEndsAt: null },
  ])('shows plan + status only for %o', (over) => {
    H.native = true;
    H.prices = PRICES; // even if prices were around, none may show
    H.sub = { ...base, ...over };
    render(<Billing />);
    expect(screen.getByText('Pro')).toBeInTheDocument();
    expect(screen.getByText(t.settings.billing.nativeNoChanges)).toBeInTheDocument();
    expect(screen.queryAllByRole('button').filter((b) => b.textContent?.trim())).toHaveLength(0);
    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(document.querySelectorAll('a')).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
    expect(H.pricesEnabled.every((e) => e === false)).toBe(true);
  });

  it('a running trial reads "Trial ends in N days."', () => {
    H.native = true;
    H.sub = base;
    render(<Billing />);
    expect(screen.getByText(/^Trial ends in \d+ days\.$/)).toBeInTheDocument();
  });

  it('finance sees no button in the shell either', () => {
    H.native = true;
    H.roles = ['finance'];
    H.sub = base;
    render(<Billing />);
    expect(screen.queryAllByRole('button').filter((b) => b.textContent?.trim())).toHaveLength(0);
  });
});

describe('Billing screen — browser', () => {
  it('without Stripe prices (stub): both intervals say "Price shown at checkout"', () => {
    H.sub = base;
    render(<Billing />);
    expect(screen.getAllByText(t.settings.billing.priceAtCheckout)).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Monthly/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: /Yearly/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t.settings.billing.setupPayment) })).toBeInTheDocument();
    expect(screen.getByText(t.settings.billing.paymentMethodTitle)).toBeInTheDocument();
  });

  it('with Stripe prices: shows both amounts and the computed yearly saving', () => {
    H.sub = base;
    H.prices = PRICES;
    render(<Billing />);
    expect(screen.getByText('€49')).toBeInTheDocument();
    expect(screen.getByText('€470.40')).toBeInTheDocument();
    expect(screen.getByText('Save 20%')).toBeInTheDocument();
  });

  it('checks out on the picked interval', () => {
    H.sub = base;
    H.checkout.mockReturnValueOnce(new Promise<string>(() => {})); // no redirect in jsdom
    render(<Billing />);
    fireEvent.click(screen.getByRole('radio', { name: /Yearly/ }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.settings.billing.setupPayment) }));
    expect(H.checkout).toHaveBeenCalledWith('year');
  });

  it('finance manages billing too', () => {
    H.roles = ['finance'];
    H.sub = base;
    render(<Billing />);
    expect(screen.getByRole('button', { name: new RegExp(t.settings.billing.setupPayment) })).toBeInTheDocument();
  });

  it('a manager (no admin/finance) sees status, no checkout', () => {
    H.roles = ['user_manager'];
    H.sub = base;
    render(<Billing />);
    expect(screen.queryByRole('button', { name: new RegExp(t.settings.billing.setupPayment) })).not.toBeInTheDocument();
  });

  it('a paying company shows "€X / year" and the renewal date', () => {
    H.sub = { ...base, status: 'active', stripeLinked: true, billingInterval: 'year', renews: '1 Oct 2027', trialEndsAt: null };
    H.prices = PRICES;
    render(<Billing />);
    expect(screen.getByText('€470.40')).toBeInTheDocument();
    expect(screen.getByText(/\/ year/)).toBeInTheDocument();
    expect(screen.getByText('1 Oct 2027')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t.settings.billing.managePortal) })).toBeInTheDocument();
  });
});

describe('BillingLockNote', () => {
  it('native: states the lock, no payment nudge, no link', () => {
    H.native = true;
    render(<BillingLockNote reason="trial_expired" onOpenBilling={vi.fn()} />);
    expect(screen.getByText(t.settings.billing.nativeBlockedTrial)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });

  it('browser: keeps the payment nudge and the Billing link', () => {
    render(<BillingLockNote reason="canceled" onOpenBilling={vi.fn()} />);
    expect(screen.getByRole('button', { name: t.settings.billing.blockedCta })).toBeInTheDocument();
  });
});
