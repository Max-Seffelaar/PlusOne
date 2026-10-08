import 'server-only';

// StripeAdapter — the ONLY module (with stripe-webhook.ts) that talks to the
// Stripe SDK (decision #32: Stripe is an implementation detail behind
// BillingProvider; a later PSP switch touches only this directory). Hosted
// Checkout + Billing Portal are pure URL redirects: no Stripe.js, no publishable
// key, and no card/IBAN data ever passes through or lands in our database.

import Stripe from 'stripe';
import { billingConfig, intervalForLookupKey, PRICE_LOOKUP_KEYS, STRIPE_API_VERSION } from './config';
import type { BillingInterval, BillingPrice, BillingPrices } from './plans';
import type {
  BillingProvider,
  CheckoutSessionInput,
  CheckoutSessionResult,
  PortalSessionInput,
  PortalSessionResult,
} from './provider';

// Stripe requires trial_end to be some margin in the future; below that we
// simply start the paid period at checkout instead of erroring.
const MIN_TRIAL_REMAINING_MS = 48 * 60 * 60 * 1000;

// Prices change rarely and only in the dashboard; ten minutes keeps a Billing
// screen from costing a Stripe round-trip per view while a dashboard edit still
// shows up the same hour. Per server instance; failures are never cached.
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

/** A price with its Stripe id — server-side only, the id never leaves here. */
interface ResolvedPrice extends BillingPrice {
  id: string;
}
type ResolvedPrices = Record<BillingInterval, ResolvedPrice | null>;

let priceCache: { at: number; prices: ResolvedPrices } | null = null;

/** Test seam: forget the cached prices. */
export function resetPriceCacheForTests(): void {
  priceCache = null;
}

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

/** Active, recurring Pro prices by lookup key → one per interval. A price
 *  whose own recurring interval disagrees with its lookup key is ignored (a
 *  "pro_yearly" that bills monthly is a dashboard mistake, not a yearly plan). */
async function resolvePrices(): Promise<ResolvedPrices> {
  if (priceCache && Date.now() - priceCache.at < PRICE_CACHE_TTL_MS) return priceCache.prices;

  const list = await getStripe().prices.list({
    lookup_keys: Object.values(PRICE_LOOKUP_KEYS),
    active: true,
    limit: 10,
  });
  const prices: ResolvedPrices = { month: null, year: null };
  for (const p of list.data) {
    const interval = intervalForLookupKey(p.lookup_key);
    if (!interval || p.recurring?.interval !== interval || typeof p.unit_amount !== 'number') continue;
    prices[interval] = { id: p.id, interval, unitAmount: p.unit_amount, currency: p.currency };
  }
  priceCache = { at: Date.now(), prices };
  return prices;
}

function publicPrice(p: ResolvedPrice | null): BillingPrice | null {
  return p ? { interval: p.interval, unitAmount: p.unitAmount, currency: p.currency } : null;
}

export class StripeAdapter implements BillingProvider {
  async listPrices(): Promise<BillingPrices | null> {
    const prices = await resolvePrices();
    return { month: publicPrice(prices.month), year: publicPrice(prices.year) };
  }

  async createCheckoutSession(input: CheckoutSessionInput): Promise<CheckoutSessionResult> {
    const price = (await resolvePrices())[input.interval];
    if (!price) return { ok: false, reason: 'misconfigured' };

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
    // lands when the trial is up, not at checkout time.
    const trialEndUnix =
      input.trialEnd && input.trialEnd.getTime() - Date.now() > MIN_TRIAL_REMAINING_MS
        ? Math.floor(input.trialEnd.getTime() / 1000)
        : undefined;

    // Our own markers, read back by the webhook (signature-verified): the
    // session's copy lets checkout.session.completed stamp the interval before
    // the first subscription event arrives.
    const metadata = {
      venue_id: input.venueId,
      plan_id: input.planId,
      billing_interval: input.interval,
    };

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      // Card, SEPA Direct Debit and iDEAL (decision #32, revised 2026-10-06).
      // An iDEAL confirmation sets up a SEPA mandate Stripe reuses for renewals.
      payment_method_types: ['card', 'sepa_debit', 'ideal'],
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      subscription_data: {
        metadata,
        ...(trialEndUnix ? { trial_end: trialEndUnix } : {}),
        ...(billingConfig.taxRateId ? { default_tax_rates: [billingConfig.taxRateId] } : {}),
      },
      client_reference_id: input.venueId,
      tax_id_collection: { enabled: true },
      // A NL B2B invoice with VAT must show the customer's address, so Checkout
      // always asks for it. With tax_id_collection on and an existing customer,
      // Stripe also requires customer_update.address = 'auto' (400 otherwise —
      // the customer we create has no address), which saves the collected name
      // and address back onto the customer for the renewal invoices.
      billing_address_collection: 'required',
      customer_update: { name: 'auto', address: 'auto' },
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
