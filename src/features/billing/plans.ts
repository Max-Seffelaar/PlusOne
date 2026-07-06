// Plan catalog — the single source of truth for the onboarding "Pick your
// plan" cards AND the Zod enum that validates a chosen plan. Billing is
// stubbed for MVP (#32/#40c): picking a plan only writes a subscriptions row
// (trialing/comped), no Stripe call happens yet. Keep this module pure (no
// server-only imports) so client and server can both read it.

export const PLAN_IDS = ['indie', 'premium', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

/** Trial length in days (#32 refinement 2026-07-06: 14 days, soft block).
 *  Client-safe here so the UI can render "Trial ends in N days"; the server
 *  carries the same value into Stripe as trial_end at checkout. */
export const TRIAL_DAYS = 14;

/** End of a venue's app-side display trial (subscription created_at + 14d). */
export function trialEndsAt(subscriptionCreatedAt: string | Date): Date {
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
  stripeSubscriptionId: string | null;
}

export type BillingBlockReason = 'canceled' | 'trial_expired' | null;

export function billingBlockReason(sub: BillingBlockInput, now: Date = new Date()): BillingBlockReason {
  if (sub.status === 'canceled') return 'canceled';
  if (sub.status === 'trialing' && !sub.stripeSubscriptionId && trialEndsAt(sub.createdAt) < now) {
    return 'trial_expired';
  }
  return null;
}

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in euro; 0 = free, null = "on request" (Pro). */
  priceEur: number | null;
  features: string[];
  popular: boolean;
}

// Copy mirrors the onboarding "Pick your plan" mockup. Pro pricing is intentionally
// "on request" until the billing-fase (#32) fixes the real Stripe prices.
export const PLANS: readonly Plan[] = [
  {
    id: 'indie',
    name: 'Indie',
    priceEur: 0,
    features: ['Check-in at the door', 'One active event'],
    popular: false,
  },
  {
    id: 'premium',
    name: 'Premium',
    priceEur: 49,
    features: ['Unlimited events', 'Up to 3 venues'],
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceEur: null,
    features: ['Everything in Premium', 'Unlimited venues', 'Priority support'],
    popular: false,
  },
];

/** Default selection in the picker — the popular plan. */
export const DEFAULT_PLAN_ID: PlanId = 'premium';

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value);
}

export function getPlan(id: PlanId): Plan {
  const plan = PLANS.find((p) => p.id === id);
  if (!plan) throw new Error(`Unknown plan: ${id}`);
  return plan;
}

/** Short price label for the plan cards. */
export function planPriceLabel(plan: Plan): string {
  if (plan.priceEur === null) return 'On request';
  if (plan.priceEur === 0) return 'Free';
  return `€${plan.priceEur}/mo`;
}
