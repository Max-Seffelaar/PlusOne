// @vitest-environment jsdom
/**
 * Store-tax seam (#32/#37) on the Billing screen and the soft-block banner.
 * In the native shell an admin sees the subscription STATUS only: no price, no
 * checkout/portal button, no payment method, no "set up your payment" nudge and
 * no pointer to the web (Apple 3.1.1/3.1.3, Play payments policy). The browser
 * keeps all of it.
 */
import '@testing-library/jest-dom';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { PoSubscription } from '@/features/po/adapters';
import { t } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  native: false,
  sub: null as unknown,
}));

vi.mock('@/lib/platform', () => ({ isNativeShell: () => H.native }));
vi.mock('@/features/po/PoLiveProvider', () => ({ usePoIdentity: () => ({ roles: ['admin'] }) }));
vi.mock('@/features/po/hooks', () => ({
  usePoSubscription: () => ({ isLoading: false, isError: false, data: H.sub }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoBillingCheckout: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
  usePoBillingPortal: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
}));
vi.mock('../../context', () => ({ useNav: () => ({ back: vi.fn(), push: vi.fn() }) }));

const { Billing } = await import('./billing');
const { BillingLockNote } = await import('../../kit');

const base: PoSubscription = {
  plan: 'Premium',
  priceLabel: '€49',
  period: 'month',
  status: 'trialing',
  renews: '—',
  events: 'Unlimited',
  venueLabel: 'Club Test',
  stripeLinked: false,
  trialEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
};

/** Anything a store reviewer would read as a price or a payment call to action. */
const PURCHASE_COPY = /€|payment|iDEAL|SEPA|checkout|portal|reactivate|on the web/i;

afterEach(() => {
  cleanup();
  H.native = false;
});

describe('Billing screen — native shell', () => {
  it.each<Partial<PoSubscription>>([
    { status: 'trialing' },
    { status: 'trialing', trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() },
    { status: 'active', stripeLinked: true, trialEndsAt: null },
    { status: 'past_due', stripeLinked: true, trialEndsAt: null },
    { status: 'canceled', trialEndsAt: null },
  ])('shows status only for %o', (over) => {
    H.native = true;
    H.sub = { ...base, ...over };
    render(<Billing />);
    expect(screen.getByText('Premium')).toBeInTheDocument();
    expect(screen.getByText(t.settings.billing.nativeNoChanges)).toBeInTheDocument();
    expect(screen.queryAllByRole('button').filter((b) => b.textContent?.trim())).toHaveLength(0);
    expect(document.body.textContent ?? '').not.toMatch(PURCHASE_COPY);
  });
});

describe('Billing screen — browser', () => {
  it('keeps price, checkout and payment method', () => {
    H.sub = base;
    render(<Billing />);
    expect(screen.getByText('€49')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: new RegExp(t.settings.billing.setupPayment) })).toBeInTheDocument();
    expect(screen.getByText(t.settings.billing.paymentMethodTitle)).toBeInTheDocument();
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
