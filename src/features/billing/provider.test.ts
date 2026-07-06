/**
 * BillingProvider selection + stub degradation (fase 13, #32): without
 * STRIPE_SECRET_KEY the app must run keyless (local dev, CI, comped pilots) —
 * checkout/portal report 'unavailable' instead of throwing — and a half-set
 * configuration (key without price) must fail loudly at import time.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadProvider() {
  vi.resetModules();
  return import('./provider');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('billing provider selection', () => {
  it('selects the stub when STRIPE_SECRET_KEY is absent', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', '');
    const { billing, StubBillingProvider } = await loadProvider();
    expect(billing).toBeInstanceOf(StubBillingProvider);
  });

  it('selects the Stripe adapter when key + price are configured', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', 'price_test');
    const { billing, StubBillingProvider } = await loadProvider();
    expect(billing).not.toBeInstanceOf(StubBillingProvider);
  });

  it('fails loudly on a key without any configured price', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', '');
    await expect(loadProvider()).rejects.toThrow(/no STRIPE_PRICE/);
  });
});

describe('stub degradation (keyless local dev)', () => {
  it('reports checkout and portal as unavailable', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { StubBillingProvider } = await loadProvider();
    const stub = new StubBillingProvider();
    await expect(
      stub.createCheckoutSession({
        venueId: 'v',
        planId: 'premium',
        company: { name: 'X', vatNumber: null, financeEmail: null },
        customerEmail: 'a@b.c',
        existingCustomerId: null,
        trialEnd: null,
        successUrl: 'https://x/s',
        cancelUrl: 'https://x/c',
      })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(
      stub.createPortalSession({ customerId: 'cus_x', returnUrl: 'https://x' })
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('keeps the onboarding startSubscription behaviour (trialing/comped)', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { StubBillingProvider } = await loadProvider();
    const stub = new StubBillingProvider();
    await expect(stub.startSubscription({ planId: 'premium' })).resolves.toEqual({
      status: 'trialing',
      planId: 'premium',
    });
    await expect(stub.startSubscription({ planId: 'indie', comped: true })).resolves.toEqual({
      status: 'comped',
      planId: 'indie',
    });
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
        if (/from\s+['"]stripe['"]/.test(src) || /require\(['"]stripe['"]\)/.test(src)) {
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
