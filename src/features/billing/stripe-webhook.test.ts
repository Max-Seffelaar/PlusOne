/**
 * Stripe webhook unit tests (fase 13, #32): the pure event→update mapping, the
 * signature gate and the handler's idempotency contract. The database side of
 * idempotency (the stripe_webhook_events ledger) is proven in pgTAP
 * (stripe_billing.test.sql); here the RPC is mocked.
 */
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WEBHOOK_SECRET = 'whsec_test_secret';

// Fixture builders — minimal event shapes, cast through unknown like Stripe's
// own event payloads (the SDK types the union per event.type).
function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return {
    id: `evt_${type.replace(/\./g, '_')}`,
    type,
    created: 1_700_000_000,
    data: { object },
  } as unknown as Stripe.Event;
}

// A real UUID: `client_reference_id` is cast to `p_venue_id uuid` by the RPC,
// so the valid/invalid distinction is load-bearing here (ClickUp 86ey9e9re).
const VENUE_ID = '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63';

function checkout(clientReferenceId: unknown): Stripe.Event {
  return event('checkout.session.completed', {
    mode: 'subscription',
    client_reference_id: clientReferenceId,
    customer: 'cus_123',
    subscription: 'sub_123',
  });
}

const checkoutCompleted = checkout(VENUE_ID);

const invoicePaid = event('invoice.paid', {
  customer: 'cus_123',
  lines: { data: [{ period: { start: 1_700_000_000, end: 1_702_592_000 } }] },
});

const invoiceFailed = event('invoice.payment_failed', {
  customer: 'cus_123',
  lines: { data: [] },
});

function subscriptionUpdated(status: string): Stripe.Event {
  return event('customer.subscription.updated', {
    id: 'sub_123',
    customer: 'cus_123',
    status,
    items: {
      data: [{ current_period_end: 1_702_592_000, price: { id: 'price_premium_test' } }],
    },
  });
}

const subscriptionDeleted = event('customer.subscription.deleted', {
  id: 'sub_123',
  customer: 'cus_123',
  status: 'canceled',
  items: { data: [] },
});

async function loadModule() {
  vi.resetModules();
  return import('./stripe-webhook');
}

describe('mapStripeEvent', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', 'price_premium_test');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('checkout.session.completed stamps ids but leaves status untouched', async () => {
    const { mapStripeEvent } = await loadModule();
    const update = mapStripeEvent(checkoutCompleted);
    expect(update).toMatchObject({
      venueId: VENUE_ID,
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      status: null,
    });
  });

  it('passes a non-UUID client_reference_id through unchanged — mapping stays pure', async () => {
    const { mapStripeEvent } = await loadModule();
    // The mapper reports what Stripe actually sent; rejecting it is the
    // handler's job, so this must NOT be silently nulled or dropped here.
    expect(mapStripeEvent(checkout('venue-uuid-1'))?.venueId).toBe('venue-uuid-1');
  });

  it('ignores a non-subscription checkout (e.g. future door payments #34)', async () => {
    const { mapStripeEvent } = await loadModule();
    expect(mapStripeEvent(event('checkout.session.completed', { mode: 'payment' }))).toBeNull();
  });

  it('invoice.paid → active with the line period end', async () => {
    const { mapStripeEvent } = await loadModule();
    const update = mapStripeEvent(invoicePaid);
    expect(update).toMatchObject({ status: 'active', stripeCustomerId: 'cus_123' });
    expect(update?.currentPeriodEnd).toBe(new Date(1_702_592_000 * 1000).toISOString());
  });

  it('invoice.payment_failed → past_due', async () => {
    const { mapStripeEvent } = await loadModule();
    expect(mapStripeEvent(invoiceFailed)).toMatchObject({ status: 'past_due' });
  });

  it.each([
    ['trialing', 'trialing'],
    ['active', 'active'],
    ['past_due', 'past_due'],
    ['unpaid', 'past_due'],
    ['canceled', 'canceled'],
  ])('customer.subscription.updated %s → %s', async (stripeStatus, ours) => {
    const { mapStripeEvent } = await loadModule();
    const update = mapStripeEvent(subscriptionUpdated(stripeStatus));
    expect(update).toMatchObject({ status: ours, stripeSubscriptionId: 'sub_123' });
  });

  it('resolves the plan from the configured price id', async () => {
    const { mapStripeEvent } = await loadModule();
    expect(mapStripeEvent(subscriptionUpdated('active'))?.planId).toBe('premium');
  });

  it.each(['incomplete', 'incomplete_expired', 'paused'])(
    'ignores unmappable subscription status %s',
    async (stripeStatus) => {
      const { mapStripeEvent } = await loadModule();
      expect(mapStripeEvent(subscriptionUpdated(stripeStatus))).toBeNull();
    }
  );

  it('customer.subscription.deleted → canceled', async () => {
    const { mapStripeEvent } = await loadModule();
    expect(mapStripeEvent(subscriptionDeleted)).toMatchObject({ status: 'canceled' });
  });

  it('returns null for unhandled event types', async () => {
    const { mapStripeEvent } = await loadModule();
    expect(mapStripeEvent(event('customer.created', {}))).toBeNull();
  });

  it('carries Stripe event.created through as an ISO timestamp (ordering guard input, ClickUp 86ey9e89j)', async () => {
    const { mapStripeEvent } = await loadModule();
    const update = mapStripeEvent(invoicePaid);
    expect(update?.eventCreated).toBe(new Date(1_700_000_000 * 1000).toISOString());
  });
});

describe('handleStripeWebhook', () => {
  const rpc = vi.fn();
  const captureServerMessage = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    captureServerMessage.mockReset();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', 'price_premium_test');
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => ({ rpc }),
    }));
    vi.doMock('@/lib/observability/sentry-server', () => ({ captureServerMessage }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/supabase/service');
    vi.doUnmock('@/lib/observability/sentry-server');
  });

  function sign(payload: string): string {
    return new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    });
  }

  it('accepts a correctly signed event and applies it via the RPC', async () => {
    const { handleStripeWebhook } = await loadModule();
    rpc.mockResolvedValue({ data: true, error: null });
    const payload = JSON.stringify(invoicePaid);
    const res = await handleStripeWebhook(payload, sign(payload));
    expect(res).toEqual({ status: 200, body: 'ok' });
    expect(rpc).toHaveBeenCalledWith(
      'apply_stripe_subscription_update',
      expect.objectContaining({
        p_event_id: invoicePaid.id,
        p_status: 'active',
        p_stripe_customer_id: 'cus_123',
        p_event_created: new Date(1_700_000_000 * 1000).toISOString(),
      })
    );
  });

  it('rejects a tampered body with 400 and never touches the database', async () => {
    const { handleStripeWebhook } = await loadModule();
    const payload = JSON.stringify(invoicePaid);
    const res = await handleStripeWebhook(payload.replace('cus_123', 'cus_evil'), sign(payload));
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a signature made with the wrong secret', async () => {
    const { handleStripeWebhook } = await loadModule();
    const payload = JSON.stringify(invoicePaid);
    const badSig = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_wrong',
    });
    const res = await handleStripeWebhook(payload, badSig);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats a replay (RPC returns false) as success — no redelivery loop', async () => {
    const { handleStripeWebhook } = await loadModule();
    rpc.mockResolvedValue({ data: false, error: null });
    const payload = JSON.stringify(invoicePaid);
    const res = await handleStripeWebhook(payload, sign(payload));
    expect(res).toEqual({ status: 200, body: 'replay' });
  });

  it('acknowledges unhandled event types without a database call', async () => {
    const { handleStripeWebhook } = await loadModule();
    const payload = JSON.stringify(event('customer.created', {}));
    const res = await handleStripeWebhook(payload, sign(payload));
    expect(res).toEqual({ status: 200, body: 'ignored' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 500 on a processing failure so Stripe retries', async () => {
    const { handleStripeWebhook } = await loadModule();
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const payload = JSON.stringify(invoicePaid);
    const res = await handleStripeWebhook(payload, sign(payload));
    expect(res.status).toBe(500);
    consoleSpy.mockRestore();
  });

  // --- client_reference_id UUID guard (ClickUp 86ey9e9re) -------------------
  // The RPC signature is `p_venue_id uuid`. A non-UUID fails Postgres' cast, so
  // WITHOUT the guard the handler answered 500 and Stripe redelivered the same
  // unfixable event with backoff for days, burying real webhook failures.

  it.each([
    ['a legacy/typo value', 'venue-uuid-1'],
    ['a dashboard-created test checkout', 'test-checkout-from-dashboard'],
    ['an attacker-supplied cast probe', "' or 1=1--"],
    ['an empty string', ''],
    ['a UUID with trailing junk', '3f1c8a52-9d6b-4f2e-8a11-7c0d5e9b4a63x'],
  ])(
    'answers 2xx and never calls the RPC for %s as client_reference_id',
    async (_label, clientReferenceId) => {
      const { handleStripeWebhook } = await loadModule();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // What Postgres actually does with a non-UUID bound to `p_venue_id uuid`.
      // Modelling it here is what makes this test red against the unguarded
      // handler for the RIGHT reason: it returned this error as a 500.
      rpc.mockResolvedValue({
        data: null,
        error: { code: '22P02', message: 'invalid input syntax for type uuid' },
      });
      const payload = JSON.stringify(checkout(clientReferenceId));

      const res = await handleStripeWebhook(payload, sign(payload));

      // 2xx is the whole point: Stripe must retire the event, not retry it.
      expect(res.status).toBe(200);
      expect(res.body).toBe('unprocessable');
      expect(rpc).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    }
  );

  it('reports the rejected event to Sentry without leaking the venue id', async () => {
    const { handleStripeWebhook } = await loadModule();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockResolvedValue({
      data: null,
      error: { code: '22P02', message: 'invalid input syntax for type uuid' },
    });
    const payload = JSON.stringify(checkout('venue-uuid-1'));

    await handleStripeWebhook(payload, sign(payload));

    expect(captureServerMessage).toHaveBeenCalledTimes(1);
    const [message, context] = captureServerMessage.mock.calls[0];
    expect(message).toContain('client_reference_id');
    // The raw value is unvalidated third-party input — it must not be logged.
    expect(JSON.stringify(context)).not.toContain('venue-uuid-1');
    consoleSpy.mockRestore();
  });

  it('applies a valid UUID client_reference_id unchanged — the happy path still works', async () => {
    const { handleStripeWebhook } = await loadModule();
    rpc.mockResolvedValue({ data: true, error: null });
    const payload = JSON.stringify(checkoutCompleted);

    const res = await handleStripeWebhook(payload, sign(payload));

    expect(res).toEqual({ status: 200, body: 'ok' });
    expect(rpc).toHaveBeenCalledWith(
      'apply_stripe_subscription_update',
      expect.objectContaining({
        p_event_id: checkoutCompleted.id,
        p_venue_id: VENUE_ID,
        p_stripe_customer_id: 'cus_123',
        p_stripe_subscription_id: 'sub_123',
      })
    );
    expect(captureServerMessage).not.toHaveBeenCalled();
  });

  it('still reaches the RPC when there is no client_reference_id at all', async () => {
    const { handleStripeWebhook } = await loadModule();
    rpc.mockResolvedValue({ data: true, error: null });
    // invoice.paid carries no venue id — the RPC matches on stripe_customer_id.
    // The guard must not mistake "absent" for "malformed".
    const payload = JSON.stringify(invoicePaid);

    const res = await handleStripeWebhook(payload, sign(payload));

    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(captureServerMessage).not.toHaveBeenCalled();
  });

  it('returns 503 when billing is not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { handleStripeWebhook } = await loadModule();
    const res = await handleStripeWebhook('{}', 't=1,v1=abc');
    expect(res.status).toBe(503);
  });
});
