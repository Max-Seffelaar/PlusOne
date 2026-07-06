// Billing abstraction (CLAUDE.md §Billing): the app never calls Stripe directly.
// Every billing side effect goes through a BillingProvider, so swapping the PSP
// (decision #32 — e.g. Mollie at scale) touches only this directory. Without
// STRIPE_SECRET_KEY the stub serves local dev and tests: checkout/portal simply
// report 'unavailable' and the UI keeps its read-only billing screen.

import type { PlanId } from './plans';
import { billingConfig } from './config';
import { StripeAdapter } from './stripe-adapter';

export type SubscriptionStartStatus = 'trialing' | 'comped';

export interface StartSubscriptionInput {
  venueId?: string;
  planId: PlanId;
  /** comped venues run without billing during pilots (#32/#40c). */
  comped?: boolean;
}

export interface StartSubscriptionResult {
  status: SubscriptionStartStatus;
  planId: PlanId;
}

export interface CheckoutSessionInput {
  venueId: string;
  planId: PlanId;
  /** Company/billing details prefilled into the Stripe customer (from venues). */
  company: {
    name: string;
    vatNumber: string | null;
    financeEmail: string | null;
  };
  /** Receipt fallback when the venue has no finance e-mail. */
  customerEmail: string;
  /** subscriptions.stripe_customer_id — reused when present (idempotent). */
  existingCustomerId: string | null;
  /** End of the remaining app-side trial; carried into Stripe as trial_end. */
  trialEnd: Date | null;
  successUrl: string;
  cancelUrl: string;
}

export type CheckoutSessionResult =
  | { ok: true; url: string; customerId: string }
  // 'free_plan': the plan has no Stripe price (free/on-request) — no checkout.
  // 'unavailable': billing is not configured (stub) or Stripe gave no URL.
  | { ok: false; reason: 'unavailable' | 'free_plan' };

export interface PortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export type PortalSessionResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'unavailable' };

export interface BillingProvider {
  startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
}

// Keyless fallback: local dev, CI and comped-only pilots run without Stripe.
export class StubBillingProvider implements BillingProvider {
  async startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
    return {
      status: input.comped ? 'comped' : 'trialing',
      planId: input.planId,
    };
  }

  async createCheckoutSession(_input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    return { ok: false, reason: 'unavailable' };
  }

  async createPortalSession(_input: PortalSessionInput): Promise<PortalSessionResult> {
    return { ok: false, reason: 'unavailable' };
  }
}

// The single provider instance the app reads from; callers never change when
// the construction here does.
export const billing: BillingProvider = billingConfig.stripeEnabled
  ? new StripeAdapter()
  : new StubBillingProvider();
