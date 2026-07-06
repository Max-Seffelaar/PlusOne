import 'server-only';

// StripeAdapter — the ONLY module (with stripe-webhook.ts) that talks to the
// Stripe SDK (decision #32: Stripe is an implementation detail behind
// BillingProvider; a later PSP switch touches only this directory). Hosted
// Checkout + Billing Portal are pure URL redirects: no Stripe.js, no publishable
// key, and no card/IBAN data ever passes through or lands in our database.

import Stripe from 'stripe';
import { billingConfig, priceIdFor, STRIPE_API_VERSION } from './config';
import type {
  BillingProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PortalSessionInput,
  PortalSessionResult,
  StartSubscriptionInput,
  StartSubscriptionResult,
} from './provider';

// Stripe requires trial_end to be some margin in the future; below that we
// simply start the paid period at checkout instead of erroring.
const MIN_TRIAL_REMAINING_MS = 48 * 60 * 60 * 1000;

let stripeSingleton: Stripe | null = null;
function getStripe(): Stripe {
  if (!billingConfig.secretKey) {
    // The provider singleton only selects this adapter when stripeEnabled;
    // reaching this means a wiring bug, not a user error.
    throw new Error('StripeAdapter constructed without STRIPE_SECRET_KEY');
  }
  stripeSingleton ??= new Stripe(billingConfig.secretKey, {
    apiVersion: STRIPE_API_VERSION,
  });
  return stripeSingleton;
}

export class StripeAdapter implements BillingProvider {
  // Unchanged from the stub: a new venue's subscription row starts trialing (or
  // comped for pilots) — Stripe only enters the picture at checkout.
  async startSubscription(input: StartSubscriptionInput): Promise<StartSubscriptionResult> {
    return {
      status: input.comped ? 'comped' : 'trialing',
      planId: input.planId,
    };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const price = priceIdFor(input.planId);
    if (!price) return { ok: false, reason: 'free_plan' };

    const stripe = getStripe();

    // Find-or-create the venue's Stripe customer. Reusing the stored id keeps
    // this idempotent; the caller persists a fresh id immediately (via
    // stamp_stripe_customer) so a webhook can always match by customer.
    let customerId = input.existingCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: input.company.name,
        email: input.company.financeEmail ?? input.customerEmail,
        metadata: { venue_id: input.venueId },
        ...(input.company.vatNumber
          ? { tax_id_data: [{ type: 'eu_vat' as const, value: input.company.vatNumber }] }
          : {}),
      });
      customerId = customer.id;
    }

    // Remaining app-side trial carries over into Stripe so the first charge
    // lands when the 14 days are up, not at checkout time.
    const trialEndUnix =
      input.trialEnd && input.trialEnd.getTime() - Date.now() > MIN_TRIAL_REMAINING_MS
        ? Math.floor(input.trialEnd.getTime() / 1000)
        : undefined;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // SEPA Direct Debit + iDEAL ONLY (decision #32). An iDEAL confirmation
      // sets up a SEPA mandate that Stripe reuses for the renewals.
      payment_method_types: ['sepa_debit', 'ideal'],
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        metadata: { venue_id: input.venueId, plan_id: input.planId },
        ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
        ...(billingConfig.taxRateId ? { default_tax_rates: [billingConfig.taxRateId] } : {}),
      },
      client_reference_id: input.venueId,
      tax_id_collection: { enabled: true },
      // Required by Stripe when tax_id_collection is on with an existing customer.
      customer_update: { name: 'auto' },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    });

    if (!session.url) return { ok: false, reason: 'unavailable' };
    return { ok: true, url: session.url, customerId };
  }

  async createPortalSession(input: PortalSessionInput): Promise<PortalSessionResult> {
    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { ok: true, url: session.url };
  }
}
