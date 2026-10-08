/**
 * BillingProvider selection + stub degradation (fase 13, #32) and the Stripe
 * adapter's price handling (Billing G). Without STRIPE_SECRET_KEY the app runs
 * keyless (local dev, CI, comped pilots): checkout/portal report 'unavailable'
 * and listPrices is null ("price shown at checkout"). With a key, prices come
 * from Stripe by lookup key — no price id in env — and the misconfiguration
 * guard that used to throw at import time now refuses the first checkout.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const S = vi.hoisted(() => ({
  pricesList: vi.fn(),
  customersCreate: vi.fn(async () => ({ id: 'cus_new' })),
  sessionsCreate: vi.fn(async () => ({ url: 'https://checkout.stripe.test/s' })),
}));

vi.mock('stripe', () => ({
  default: class {
    prices = { list: S.pricesList };
    customers = { create: S.customersCreate };
    checkout = { sessions: { create: S.sessionsCreate } };
    billingPortal = { sessions: { create: vi.fn() } };
  },
}));

async function loadProvider() {
  vi.resetModules();
  return import('./provider');
}

const checkoutInput = (interval: 'month' | 'year') => ({
  venueId: 'v',
  planId: 'pro' as const,
  interval,
  company: { name: 'X', vatNumber: null, financeEmail: null },
  customerEmail: 'a@b.c',
  existingCustomerId: null,
  trialEnd: null,
  successUrl: 'https://x/s',
  cancelUrl: 'https://x/c',
});

function stripePrice(lookup_key: string, interval: string, unit_amount: number) {
  return { id: `price_${lookup_key}`, lookup_key, unit_amount, currency: 'eur', recurring: { interval } };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('billing provider selection', () => {
  it('selects the stub when STRIPE_SECRET_KEY is absent', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { billing, StubBillingProvider } = await loadProvider();
    expect(billing).toBeInstanceOf(StubBillingProvider);
  });

  it('selects the Stripe adapter on a key alone — no price id in env any more', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    const { billing, StubBillingProvider } = await loadProvider();
    expect(billing).not.toBeInstanceOf(StubBillingProvider);
  });
});

describe('stub degradation (keyless local dev)', () => {
  it('reports checkout and portal as unavailable and has no prices', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { StubBillingProvider } = await loadProvider();
    const stub = new StubBillingProvider();
    await expect(stub.createCheckoutSession(checkoutInput('month'))).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
    await expect(
      stub.createPortalSession({ customerId: 'cus_x', returnUrl: 'https://x' })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(stub.listPrices()).resolves.toBeNull();
  });
});

describe('Stripe adapter — prices by lookup key', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
  });

  it('reads both Pro prices by lookup key and never hands out a price id', async () => {
    S.pricesList.mockResolvedValue({
      data: [stripePrice('pro_monthly', 'month', 4900), stripePrice('pro_yearly', 'year', 47040)],
    });
    const { billing } = await loadProvider();
    const prices = await billing.listPrices();
    expect(S.pricesList).toHaveBeenCalledWith(
      expect.objectContaining({ lookup_keys: ['pro_monthly', 'pro_yearly'], active: true })
    );
    expect(prices).toEqual({
      month: { interval: 'month', unitAmount: 4900, currency: 'eur' },
      year: { interval: 'year', unitAmount: 47040, currency: 'eur' },
    });
    expect(JSON.stringify(prices)).not.toContain('price_');
  });

  it('caches the prices server-side (one Stripe call for repeated reads)', async () => {
    S.pricesList.mockResolvedValue({ data: [stripePrice('pro_monthly', 'month', 4900)] });
    const { billing } = await loadProvider();
    await billing.listPrices();
    await billing.listPrices();
    expect(S.pricesList).toHaveBeenCalledTimes(1);
  });

  it('ignores a price whose recurring interval contradicts its lookup key', async () => {
    S.pricesList.mockResolvedValue({ data: [stripePrice('pro_yearly', 'month', 4900)] });
    const { billing } = await loadProvider();
    await expect(billing.listPrices()).resolves.toEqual({ month: null, year: null });
  });

  it('checks out on the looked-up price with card, SEPA and iDEAL, and marks the interval', async () => {
    S.pricesList.mockResolvedValue({
      data: [stripePrice('pro_monthly', 'month', 4900), stripePrice('pro_yearly', 'year', 47040)],
    });
    const { billing } = await loadProvider();
    await expect(billing.createCheckoutSession(checkoutInput('year'))).resolves.toEqual({
      ok: true,
      url: 'https://checkout.stripe.test/s',
      customerId: 'cus_new',
    });
    const arg = (S.sessionsCreate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg.line_items).toEqual([{ price: 'price_pro_yearly', quantity: 1 }]);
    expect(arg.payment_method_types).toEqual(['card', 'sepa_debit', 'ideal']);
    expect(arg.metadata).toMatchObject({ venue_id: 'v', plan_id: 'pro', billing_interval: 'year' });
  });

  it('collects and saves the billing address (tax ID collection on an existing customer)', async () => {
    S.pricesList.mockResolvedValue({ data: [stripePrice('pro_monthly', 'month', 4900)] });
    const { billing } = await loadProvider();
    await billing.createCheckoutSession(checkoutInput('month'));
    const arg = (S.sessionsCreate.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg.tax_id_collection).toEqual({ enabled: true });
    expect(arg.billing_address_collection).toBe('required');
    expect(arg.customer_update).toEqual({ name: 'auto', address: 'auto' });
  });

  it('misconfiguration guard: no price under the lookup key refuses the checkout, no session', async () => {
    S.pricesList.mockResolvedValue({ data: [stripePrice('pro_monthly', 'month', 4900)] });
    const { billing } = await loadProvider();
    await expect(billing.createCheckoutSession(checkoutInput('year'))).resolves.toEqual({
      ok: false,
      reason: 'misconfigured',
    });
    expect(S.sessionsCreate).not.toHaveBeenCalled();
    expect(S.customersCreate).not.toHaveBeenCalled();
  });
});

describe('stripe SDK confinement (decision #32 — abstraction is mandatory)', () => {
  it("imports 'stripe' only inside src/features/billing/", async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const path = await import('node:path');
    const SRC = path.resolve(process.cwd(), 'src');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.tsx?$/.test(entry.name) || /\.(test|spec)\.tsx?$/.test(entry.name)) continue;
        const src = readFileSync(full, 'utf8');
        if (
          /from\s+['"]stripe['"]/.test(src) ||
          /require\(['"]stripe['"]\)/.test(src) ||
          /import\(\s*['"]stripe['"]\s*\)/.test(src)
        ) {
          if (!full.includes(path.join('features', 'billing'))) {
            offenders.push(path.relative(SRC, full));
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
