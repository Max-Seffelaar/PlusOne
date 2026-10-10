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
import { billingConfig, intervalForLookupKey, STRIPE_API_VERSION } from './config';
import { isBillingInterval, PLAN_ID, type BillingInterval } from './plans';

// `client_reference_id` is an arbitrary Stripe-side string, not a validated id:
// a checkout started from the Stripe dashboard, a legacy/typo value or an
// attacker-supplied one all arrive here verbatim. The RPC declares
// `p_venue_id uuid`, so anything non-UUID fails Postgres' cast — see the guard
// in handleStripeWebhook (ClickUp 86ey9e9re).
const venueIdSchema = z.string().uuid();

/** How much of an arbitrarily long third-party value is worth scanning. */
const FINGERPRINT_SCAN_MAX = 4096;

export interface RejectedValueFingerprint {
  valueType: string;
  valueLength: number | null;
  /** `+`-joined character classes present, e.g. `dash+hex` for a uuid. */
  valueCharset: string;
}

/** Exactly one bucket per character; `hex` is checked before `alpha` so a
 *  uuid reads as `dash+hex` rather than a mix of alpha and digits. */
function charClassOf(char: string): string {
  if (/[0-9a-fA-F]/.test(char)) return 'hex';
  if (/[a-zA-Z]/.test(char)) return 'alpha';
  if (char === '-') return 'dash';
  if (/\s/.test(char)) return 'space';
  return /[\x21-\x7e]/.test(char) ? 'punct' : 'other';
}

const CHAR_CLASS_COUNT = 6;

/**
 * A NON-REVERSIBLE description of a rejected `client_reference_id`, for logs.
 *
 * Only derived facts leave this function — never a character of the value.
 * Length plus the set of character classes present is what an operator needs
 * to triage without opening the Stripe dashboard: `dash+hex` at length 18 is a
 * truncated uuid, `alpha+dash+hex` is a hand-typed label, `punct` alone is a
 * pasted JSON blob. It cannot reconstruct the value, and the class set is
 * capped at six members, so the log line is bounded however long the junk is.
 *
 * Takes `unknown`: `venueId` is `string | null` to TypeScript, but it is
 * deserialised from a third-party JSON body, so a non-string can reach here at
 * runtime — which is itself the single most useful thing to log.
 */
export function fingerprintOf(value: unknown): RejectedValueFingerprint {
  if (typeof value !== 'string') {
    return {
      valueType: value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value,
      valueLength: null,
      valueCharset: '',
    };
  }

  const classes = new Set<string>();
  for (const char of value.slice(0, FINGERPRINT_SCAN_MAX)) {
    classes.add(charClassOf(char));
    if (classes.size === CHAR_CLASS_COUNT) break; // nothing left to learn
  }

  return {
    valueType: 'string',
    valueLength: value.length,
    valueCharset: [...classes].sort().join('+'),
  };
}

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
  /** month|year; null = leave untouched (Billing G, 20261008120100). */
  billingInterval: BillingInterval | null;
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

/** Plan + interval of a subscription's (single) price. The plan is Pro only
 *  when the price carries one of OUR lookup keys — any other price (a stray
 *  dashboard product) leaves plan_id untouched. The interval comes from the
 *  price's own recurring interval, which is what Stripe actually bills. */
function planOfSubscription(sub: Stripe.Subscription): { planId: string | null; billingInterval: BillingInterval | null } {
  const price = sub.items.data[0]?.price;
  const recurring = price?.recurring?.interval;
  return {
    planId: intervalForLookupKey(price?.lookup_key) ? PLAN_ID : null,
    billingInterval: isBillingInterval(recurring) ? recurring : null,
  };
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
    billingInterval: null as BillingInterval | null,
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
      // billing_interval is our own marker on the session (set by the
      // adapter at checkout), so the interval lands before the first
      // subscription event; anything else is ignored, never trusted.
      const interval = session.metadata?.billing_interval;
      return {
        ...base,
        venueId: session.client_reference_id ?? null,
        stripeCustomerId: customerIdOf(session.customer),
        stripeSubscriptionId: subscription,
        billingInterval: isBillingInterval(interval) ? interval : null,
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
    // created: a checkout with a carried-over trial produces no invoice and
    // no update until the trial ends, so without it "Renews" would stay empty
    // for up to 14 days. Same mapping as updated.
    case 'customer.subscription.created':
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const status = mapSubscriptionStatus(sub.status);
      if (!status) return null;
      return {
        ...base,
        stripeCustomerId: customerIdOf(sub.customer),
        stripeSubscriptionId: sub.id,
        status,
        ...planOfSubscription(sub),
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
    // Never the raw value: it is unvalidated third-party input and could carry
    // anything (CLAUDE.md §Security — no PII in logs). Length and character
    // classes are derived facts ABOUT the junk, not the junk itself, and are
    // what lets an operator tell a truncated uuid from a pasted blob without
    // opening the Stripe dashboard.
    const fingerprint = fingerprintOf(update.venueId);
    // `warning`, not `error`, on BOTH sinks: this branch has deliberately
    // decided the event is not actionable (it answers 200 on purpose). Vercel
    // log drains and alerting key on console.error, so console.error here
    // would page for a condition the code already resolved.
    await captureServerMessage('stripe webhook: unusable client_reference_id', {
      level: 'warning',
      tags: { stripe_event_type: update.eventType },
      extra: { eventId: update.eventId, ...fingerprint },
    });
    console.warn('stripe webhook unprocessable client_reference_id', {
      eventId: update.eventId,
      eventType: update.eventType,
      ...fingerprint,
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
    p_billing_interval: update.billingInterval ?? undefined,
  });

  if (error) {
    // Generic body (no event details leak back); specifics go to server logs.
    console.error('stripe webhook apply failed', { eventId: update.eventId, error: error.message });
    return { status: 500, body: 'processing failed' };
  }

  // Billing mail (z8uq9m2z19): queue "payment failed" / "subscription ended"
  // for the billing-mail job. Also on a replay, on purpose: the queue is keyed
  // by the Stripe event id (a second call is a no-op, so a replay never mails
  // twice), and the RPC only queues events the ledger above already holds. A
  // failed queue call answers 500 so Stripe redelivers; that redelivery is a
  // ledger replay that lands right back here and queues it then.
  if (BILLING_MAIL_EVENTS.has(update.eventType) && update.stripeCustomerId) {
    const { error: mailError } = await supabase.rpc('enqueue_billing_event_mail', {
      p_stripe_event_id: update.eventId,
      p_stripe_customer_id: update.stripeCustomerId,
      p_event_created: update.eventCreated ?? undefined,
    });
    if (mailError) {
      console.error('stripe webhook billing mail queue failed', { eventId: update.eventId, code: mailError.code });
      return { status: 500, body: 'processing failed' };
    }
  }

  return { status: 200, body: applied ? 'ok' : 'replay' };
}

/** Stripe events that queue a billing mail (enqueue_billing_event_mail). */
const BILLING_MAIL_EVENTS = new Set(['invoice.payment_failed', 'customer.subscription.deleted']);
