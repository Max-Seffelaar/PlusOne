import 'server-only';

// Billing configuration (decision #32, revised 2026-10-06). No amounts and no
// price ids live in code or env: the app finds the Pro prices in Stripe by
// LOOKUP KEY (pro_monthly / pro_yearly) and reads them live (provider
// listPrices, cached server-side). Missing STRIPE_SECRET_KEY = Stripe disabled
// = the stub provider serves local dev and tests without keys.
//
// Misconfiguration guard: a key whose Stripe account has no active price under
// a lookup key used to throw here at import time (when price ids were env).
// Prices are now remote, so the guard lives where a missing price actually
// dead-ends: the first checkout for that interval refuses with 'misconfigured'
// and logs loudly (createCheckoutSessionAction).

import type { BillingInterval } from './plans';

// Trial length lives in plans.ts (client-safe, the UI renders the countdown);
// re-exported here for server callers that already import the config.
export { TRIAL_DAYS } from './plans';

/** Pinned Stripe API version (stripe@18 default); bump deliberately with the SDK. */
export const STRIPE_API_VERSION = '2025-08-27.basil' as const;

/** Stripe price lookup keys of the one plan, per interval. Set on the two Pro
 *  prices in the dashboard (docs/stripe-setup.md §1). */
export const PRICE_LOOKUP_KEYS: Record<BillingInterval, string> = {
  month: 'pro_monthly',
  year: 'pro_yearly',
};

/** Reverse lookup for the webhook: lookup key → interval; null for any other key. */
export function intervalForLookupKey(lookupKey: string | null | undefined): BillingInterval | null {
  if (!lookupKey) return null;
  for (const [interval, key] of Object.entries(PRICE_LOOKUP_KEYS)) {
    if (key === lookupKey) return interval as BillingInterval;
  }
  return null;
}

export interface BillingConfig {
  stripeEnabled: boolean;
  secretKey: string | null;
  webhookSecret: string | null;
  /** Manual 21% NL BTW tax rate (txr_...), applied to every checkout line. */
  taxRateId: string | null;
}

function readConfig(): BillingConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY || null;
  return {
    stripeEnabled: Boolean(secretKey),
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    taxRateId: process.env.STRIPE_TAX_RATE_ID || null,
  };
}

export const billingConfig: BillingConfig = readConfig();
