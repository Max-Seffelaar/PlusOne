import 'server-only';

// Stripe webhook processing (decision #32): Stripe state flows into the
// subscriptions table via webhooks ONLY. This module verifies the signature,
// maps the event to a subscription update (pure, unit-testable) and applies it
// through the service-role RPC apply_stripe_subscription_update — the
// documented service-role exception from CLAUDE.md §Billing. Idempotency lives
// in the RPC (stripe_webhook_events ledger): a replayed event returns false
// and mutates nothing.

import Stripe from 'stripe';
import { createServiceClient } from '@/lib/supabase/service';
import { billingConfig, planIdForPrice, STRIPE_API_VERSION } from './config';

type MappedStatus = 'trialing' | 'active' | 'past_due' | 'canceled';

export interface StripeSubscriptionUpdate {
  eventId: string;
  eventType: string;
  venueId: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  /** null = leave the current status untouched. */
  status: MappedStatus | null;
  planId: string | null;
  /** ISO timestamp; null = leave untouched. */
  currentPeriodEnd: string | null;
}

function customerIdOf(
  customer: string | Stripe.Customer | Stripe.DeletedCustomer | null
): string | null {
  if (!customer) return null;
  return typeof customer === 'string' ? customer : customer.id;
}

function isoFromUnix(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' ? new Date(seconds * 1000).toISOString() : null;
}

// Stripe subscription.status → our enum. incomplete/incomplete_expired/paused
// have no meaningful mapping (checkout never completed / not a state we sell):
// those events are ignored entirely.
function mapSubscriptionStatus(status: Stripe.Subscription.Status): MappedStatus | null {
  switch (status) {
    case 'trialing':
      return 'trialing';
    case 'active':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
      return 'canceled';
    default:
      return null;
  }
}

/** Latest service-period end across the subscription's items (basil API moved
 *  current_period_end from the subscription onto its items). */
function periodEndOfSubscription(sub: Stripe.Subscription): string | null {
  const ends = sub.items.data
    .map((item) => item.current_period_end)
    .filter((end): end is number => typeof end === 'number');
  return ends.length ? isoFromUnix(Math.max(...ends)) : null;
}

function periodEndOfInvoice(invoice: Stripe.Invoice): string | null {
  const ends = invoice.lines.data
    .map((line) => line.period?.end)
    .filter((end): end is number => typeof end === 'number');
  return ends.length ? isoFromUnix(Math.max(...ends)) : null;
}

/**
 * Pure event → update mapping. Returns null for events that must not mutate
 * anything (unhandled types, non-subscription checkouts, unmappable statuses).
 *
 * Status flow: checkout.session.completed only stamps the Stripe ids — the
 * row is already 'trialing' and Stripe follows up with invoice.paid (no trial)
 * or customer.subscription.updated, which carry the authoritative status.
 */
export function mapStripeEvent(event: Stripe.Event): StripeSubscriptionUpdate | null {
  const base = {
    eventId: event.id,
    eventType: event.type,
    venueId: null as string | null,
    stripeCustomerId: null as string | null,
    stripeSubscriptionId: null as string | null,
    status: null as MappedStatus | null,
    planId: null as string | null,
    currentPeriodEnd: null as string | null,
  };

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      if (session.mode !== 'subscription') return null;
      const subscription =
        typeof session.subscription === 'string'
          ? session.subscription
          : (session.subscription?.id ?? null);
      return {
        ...base,
        venueId: session.client_reference_id ?? null,
        stripeCustomerId: customerIdOf(session.customer),
        stripeSubscriptionId: subscription,
      };
    }
    case 'invoice.paid': {
      const invoice = event.data.object;
      return {
        ...base,
        stripeCustomerId: customerIdOf(invoice.customer),
        status: 'active',
        currentPeriodEnd: periodEndOfInvoice(invoice),
      };
    }
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      return {
        ...base,
        stripeCustomerId: customerIdOf(invoice.customer),
        status: 'past_due',
      };
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const status = mapSubscriptionStatus(sub.status);
      if (!status) return null;
      const priceId = sub.items.data[0]?.price?.id ?? null;
      return {
        ...base,
        stripeCustomerId: customerIdOf(sub.customer),
        stripeSubscriptionId: sub.id,
        status,
        planId: priceId ? planIdForPrice(priceId) : null,
        currentPeriodEnd: periodEndOfSubscription(sub),
      };
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      return {
        ...base,
        stripeCustomerId: customerIdOf(sub.customer),
        stripeSubscriptionId: sub.id,
        status: 'canceled',
      };
    }
    default:
      return null;
  }
}

export interface WebhookResult {
  status: number;
  body: string;
}

/**
 * Verify + map + apply one webhook delivery. Response contract for Stripe:
 * 2xx = processed (including replays and ignored event types — never redeliver),
 * 400 = bad signature (misconfiguration; redelivery won't help),
 * 500 = transient processing failure (Stripe retries with backoff).
 */
export async function handleStripeWebhook(
  rawBody: string,
  signature: string
): Promise<WebhookResult> {
  if (!billingConfig.stripeEnabled || !billingConfig.secretKey || !billingConfig.webhookSecret) {
    return { status: 503, body: 'billing not configured' };
  }

  let event: Stripe.Event;
  try {
    const stripe = new Stripe(billingConfig.secretKey, { apiVersion: STRIPE_API_VERSION });
    event = stripe.webhooks.constructEvent(rawBody, signature, billingConfig.webhookSecret);
  } catch {
    return { status: 400, body: 'invalid signature' };
  }

  const update = mapStripeEvent(event);
  if (!update) return { status: 200, body: 'ignored' };

  const supabase = createServiceClient();
  const { data: applied, error } = await supabase.rpc('apply_stripe_subscription_update', {
    p_event_id: update.eventId,
    p_event_type: update.eventType,
    p_venue_id: update.venueId ?? undefined,
    p_stripe_customer_id: update.stripeCustomerId ?? undefined,
    p_stripe_subscription_id: update.stripeSubscriptionId ?? undefined,
    p_status: update.status ?? undefined,
    p_plan_id: update.planId ?? undefined,
    p_current_period_end: update.currentPeriodEnd ?? undefined,
  });

  if (error) {
    // Generic body (no event details leak back); specifics go to server logs.
    console.error('stripe webhook apply failed', { eventId: update.eventId, error: error.message });
    return { status: 500, body: 'processing failed' };
  }

  return { status: 200, body: applied ? 'ok' : 'replay' };
}
