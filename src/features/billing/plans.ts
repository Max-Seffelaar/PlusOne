// Plan catalog — the single source of truth for the onboarding "Kies je
// abonnement" cards AND the Zod enum that validates a chosen plan. Billing is
// stubbed for MVP (#32/#40c): picking a plan only writes a subscriptions row
// (trialing/comped), no Stripe call happens yet. Keep this module pure (no
// server-only imports) so client and server can both read it.

export const PLAN_IDS = ['indie', 'premium', 'pro'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Monthly price in euro; 0 = gratis, null = "op aanvraag" (Pro). */
  priceEur: number | null;
  features: string[];
  popular: boolean;
}

// Copy mirrors the onboarding "Plan kiezen" mockup. Pro pricing is intentionally
// "op aanvraag" until the billing-fase (#32) fixes the real Stripe prices.
export const PLANS: readonly Plan[] = [
  {
    id: 'indie',
    name: 'Indie',
    priceEur: 0,
    features: ['Check-in aan de deur', 'Eén actief event'],
    popular: false,
  },
  {
    id: 'premium',
    name: 'Premium',
    priceEur: 49,
    features: ['Onbeperkte events', 'Tot 3 venues'],
    popular: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceEur: null,
    features: ['Alles uit Premium', 'Onbeperkt venues', 'Priority support'],
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
  if (plan.priceEur === null) return 'Op aanvraag';
  if (plan.priceEur === 0) return 'Gratis';
  return `€${plan.priceEur}/mnd`;
}
