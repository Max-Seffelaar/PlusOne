// The plan — one, Pro (decision #32 revised 2026-10-06, Billing G). Every company
// runs on Pro: a 14-day trial, then monthly or yearly through Stripe. The
// amounts live in Stripe only (lookup keys pro_monthly / pro_yearly, read live
// by the server); this module knows the plan's name, the trial rule and how to
// format a price Stripe hands back. Keep it pure (no server-only imports) so the
// server gate and the po UI read the SAME trial rule.

export const PLAN_IDS = ['pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** The one plan. Every subscription row carries it since 20261008120000. */
export const PLAN_ID: PlanId = 'pro';
export const PLAN_NAME = 'Pro';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

/** Monthly or yearly (yearly is paid upfront, at a discount Stripe's two prices
 *  define — the app never hard-codes the percentage). */
export const BILLING_INTERVALS = ['month', 'year'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

export function isBillingInterval(value: unknown): value is BillingInterval {
  return typeof value === 'string' && (BILLING_INTERVALS as readonly string[]).includes(value);
}

/** Trial length in days (#32: 14 days, soft block). Client-safe so the UI can
 *  render "Trial ends in N days"; the server carries the same end date into
 *  Stripe as trial_end at checkout. */
export const TRIAL_DAYS = 14;

/**
 * The ONE trial-end rule (Billing G, spike 9.1): a platform admin's override
 * (`subscriptions.trial_ends_at`, set_venue_trial_end) wins, otherwise the row's
 * created_at + 14 days — `coalesce(trial_ends_at, created_at + 14 d)`. The
 * server gate (billingBlockReason via gate.ts), the Billing screen
 * (toPoSubscription) and checkout's Stripe trial_end all call this, so server
 * and UI can never disagree about when a trial ends.
 */
export function effectiveTrialEndsAt(
  subscriptionCreatedAt: string | Date,
  trialEndsAtOverride?: string | Date | null
): Date {
  if (trialEndsAtOverride) return new Date(trialEndsAtOverride);
  const start = new Date(subscriptionCreatedAt);
  return new Date(start.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
}

// ── Soft-block decision (#32 refinement: 14-day trial, soft block) ───────────
// Pure and client-safe: the server gate (gate.ts) and the po UI locks read the
// SAME rule so they can never disagree. Blocked = canceled, or a lapsed trial
// that never completed checkout. trialing-with-Stripe is Stripe's clock
// (trial_end), past_due is dunning's (banner only), comped never blocks.

export interface BillingBlockInput {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'comped';
  createdAt: string | Date;
  /** subscriptions.trial_ends_at — the platform-admin override; null = default. */
  trialEndsAt: string | Date | null;
  stripeSubscriptionId: string | null;
}

export type BillingBlockReason = 'canceled' | 'trial_expired' | null;

export function billingBlockReason(sub: BillingBlockInput, now: Date = new Date()): BillingBlockReason {
  if (sub.status === 'canceled') return 'canceled';
  if (
    sub.status === 'trialing' &&
    !sub.stripeSubscriptionId &&
    effectiveTrialEndsAt(sub.createdAt, sub.trialEndsAt) < now
  ) {
    return 'trial_expired';
  }
  return null;
}

// ── Prices (read live from Stripe, never stored) ─────────────────────────────

/** One Stripe price as the app shows it. `unitAmount` is in minor units (cents),
 *  excl. VAT (the 21% tax rate is exclusive, docs/stripe-setup.md). */
export interface BillingPrice {
  interval: BillingInterval;
  unitAmount: number;
  currency: string;
}

/** Both Pro prices; a side is null when Stripe has no active price for it. */
export interface BillingPrices {
  month: BillingPrice | null;
  year: BillingPrice | null;
}

/** "€49" / "€39.50" — a whole amount drops the cents. Non-EUR falls back to
 *  the ISO code so a wrong dashboard currency is visible, never disguised. */
export function formatPriceAmount(price: Pick<BillingPrice, 'unitAmount' | 'currency'>): string {
  const major = price.unitAmount / 100;
  const amount = Number.isInteger(major) ? String(major) : major.toFixed(2);
  return price.currency.toLowerCase() === 'eur' ? `€${amount}` : `${amount} ${price.currency.toUpperCase()}`;
}

/** Yearly discount against twelve monthly payments, whole percent; null when
 *  either price is missing, the currencies differ, or yearly saves nothing. */
export function yearlySavingsPercent(prices: BillingPrices | null): number | null {
  const m = prices?.month;
  const y = prices?.year;
  if (!m || !y || m.unitAmount <= 0 || m.currency.toLowerCase() !== y.currency.toLowerCase()) return null;
  const pct = Math.round((1 - y.unitAmount / (m.unitAmount * 12)) * 100);
  return pct > 0 ? pct : null;
}
