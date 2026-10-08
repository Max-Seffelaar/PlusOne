// Billing abstraction (CLAUDE.md §Billing): the app never calls Stripe directly.
// Every billing side effect goes through a BillingProvider, so swapping the PSP
// (decision #32 — e.g. Mollie at scale) touches only this directory. Without
// STRIPE_SECRET_KEY the stub serves local dev and tests: checkout/portal simply
// report 'unavailable', listPrices returns null ("price shown at checkout") and
// the UI keeps its read-only billing screen.
//
// No startSubscription any more (Billing G): a company's subscription row is
// created as trialing Pro by create_venue_with_owner itself, so there is no
// provider decision left at company creation.

import type { BillingInterval, BillingPrices, PlanId } from './plans';
import { billingConfig } from './config';
import { StripeAdapter } from './stripe-adapter';

export interface CheckoutSessionInput {
  venueId: string;
  planId: PlanId;
  /** Monthly or yearly — picks the Stripe price by lookup key. */
  interval: BillingInterval;
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
  // 'unavailable': billing is not configured (stub) or Stripe gave no URL.
  // 'misconfigured': Stripe is on, but has no active price under the lookup
  //   key for this interval — the dashboard is incomplete (the guard that used
  //   to throw at import time when price ids were env).
  | { ok: false; reason: 'unavailable' | 'misconfigured' };

export interface PortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export type PortalSessionResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'unavailable' };

export interface BillingProvider {
  /** The Pro prices, live from the PSP (cached server-side). null = no billing
   *  configured (stub) — the UI then says the price is shown at checkout. */
  listPrices(): Promise<BillingPrices | null>;
  createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult>;
  createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult>;
}

// Keyless fallback: local dev, CI and comped-only pilots run without Stripe.
export class StubBillingProvider implements BillingProvider {
  async listPrices(): Promise<BillingPrices | null> {
    return null;
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
