import 'server-only';

// Stripe webhook processing (decision #32): Stripe state flows into the
// subscriptions table via webhooks ONLY. This module verifies the signature,
// maps the event to a subscription update (pure, unit-testable) and applies it
// through the service-role RPC apply_stripe_subscription_update — the
// documented service-role exception from CLAUDE.md §Billing. Idempotency lives
// in the RPC (stripe_webhook_events ledger): a replayed event returns false
// and mutates nothing. Ordering lives there too (ClickUp 86ey9e89j): each
// mapped event carries Stripe's own event.created, and the RPC ignores
// status/plan/period fields from an event older than the last one it applied
// to that subscription — Stripe redelivers out of order, so a late
// invoice.paid must not undo a newer customer.subscription.deleted.

import Stripe from 'stripe';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { captureServerMessage } from '@/lib/observability/sentry-server';
import { billingConfig, planIdForPrice, STRIPE_API_VERSION } from './config';

// `client_reference_id` is an arbitrary Stripe-side string, not a validated id:
// a checkout started from the Stripe dashboard, a legacy/typo value or an
// attacker-supplied one all arrive here verbatim. The RPC declares
// `p_venue_id uuid`, so anything non-UUID fails Postgres' cast — see the guard
// in handleStripeWebhook (ClickUp 86ey9e9re).
const venueIdSchema = z.string().uuid();

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
  /** ISO timestamp of Stripe's event.created — drives the ordering guard. */
  eventCreated: string | null;
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
    eventCreated: isoFromUnix(event.created),
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
 * 2xx = processed (including replays, ignored event types and unprocessable
 *       events — never redeliver),
 * 400 = bad signature (misconfiguration; redelivery won't help),
 * 500 = transient processing failure (Stripe retries with backoff).
 *
 * The 2xx-for-unprocessable rule is what keeps a poison event out of Stripe's
 * retry queue: a malformed `client_reference_id` can never become valid on
 * redelivery, so answering 500 would make Stripe replay the same broken event
 * with backoff for days and bury genuine webhook failures in the noise.
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

  // A null venueId is normal and must keep flowing: invoice/subscription events
  // carry no client_reference_id and the RPC matches them on stripe_customer_id.
  // A PRESENT but non-UUID value is the poison case — the RPC's `p_venue_id uuid`
  // cast would raise, and we would answer 500 to an event that can never succeed.
  if (update.venueId !== null && !venueIdSchema.safeParse(update.venueId).success) {
    // No venue id in the message body or tags: it is unvalidated third-party
    // input and could carry anything (CLAUDE.md §Security — no PII in logs).
    await captureServerMessage('stripe webhook: unusable client_reference_id', {
      level: 'warning',
      tags: { stripe_event_type: update.eventType },
      extra: { eventId: update.eventId },
    });
    console.error('stripe webhook unprocessable client_reference_id', {
      eventId: update.eventId,
      eventType: update.eventType,
    });
    return { status: 200, body: 'unprocessable' };
  }

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
    p_event_created: update.eventCreated ?? undefined,
  });

  if (error) {
    // Generic body (no event details leak back); specifics go to server logs.
    console.error('stripe webhook apply failed', { eventId: update.eventId, error: error.message });
    return { status: 500, body: 'processing failed' };
  }

  return { status: 200, body: applied ? 'ok' : 'replay' };
}
