import 'server-only';

// Billing configuration (decision #32). Everything price-related is env-driven:
// the amounts live in the Stripe dashboard, the app only knows price IDs. A plan
// without a configured price ID has no checkout path (free/on-request plans skip
// Stripe entirely). Missing STRIPE_SECRET_KEY = Stripe disabled = the stub
// provider serves local dev and tests without keys.

import type { PlanId } from './plans';

// Trial length lives in plans.ts (client-safe, the UI renders the countdown);
// re-exported here for server callers that already import the config.
export { TRIAL_DAYS } from './plans';

/** Pinned Stripe API version (stripe@18 default); bump deliberately with the SDK. */
export const STRIPE_API_VERSION = '2025-08-27.basil' as const;

export interface BillingConfig {
  stripeEnabled: boolean;
  secretKey: string | null;
  webhookSecret: string | null;
  /** Stripe price id per plan; undefined = plan has no checkout (free/on request). */
  priceIds: Partial<Record<PlanId, string>>;
  /** Manual 21% NL BTW tax rate (txr_...), applied to every checkout line. */
  taxRateId: string | null;
}

function readConfig(): BillingConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY || null;
  const priceIds: Partial<Record<PlanId, string>> = {};
  const premium = process.env.STRIPE_PRICE_PREMIUM_MONTHLY;
  if (premium) priceIds.premium = premium;

  const enabled = Boolean(secretKey);
  if (enabled && Object.keys(priceIds).length === 0) {
    // Misconfiguration guard: a key without any price means every checkout
    // would dead-end. Fail loudly at import time, not per-request.
    throw new Error('STRIPE_SECRET_KEY is set but no STRIPE_PRICE_* is configured');
  }

  return {
    stripeEnabled: enabled,
    secretKey,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || null,
    priceIds,
    taxRateId: process.env.STRIPE_TAX_RATE_ID || null,
  };
}

export const billingConfig: BillingConfig = readConfig();

/** The checkout price for a plan, or null when the plan has no paid path. */
export function priceIdFor(planId: PlanId): string | null {
  return billingConfig.priceIds[planId] ?? null;
}

/** Reverse lookup: Stripe price id → our plan id (webhook plan sync). */
export function planIdForPrice(priceId: string): PlanId | null {
  for (const [plan, price] of Object.entries(billingConfig.priceIds)) {
    if (price === priceId) return plan as PlanId;
  }
  return null;
}
