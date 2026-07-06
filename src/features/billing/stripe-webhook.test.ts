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
    data: { object },
  } as unknown as Stripe.Event;
}

const checkoutCompleted = event('checkout.session.completed', {
  mode: 'subscription',
  client_reference_id: 'venue-uuid-1',
  customer: 'cus_123',
  subscription: 'sub_123',
});

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
      venueId: 'venue-uuid-1',
      stripeCustomerId: 'cus_123',
      stripeSubscriptionId: 'sub_123',
      status: null,
    });
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
});

describe('handleStripeWebhook', () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_dummy');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', WEBHOOK_SECRET);
    vi.stubEnv('STRIPE_PRICE_PREMIUM_MONTHLY', 'price_premium_test');
    vi.doMock('@/lib/supabase/service', () => ({
      createServiceClient: () => ({ rpc }),
    }));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('@/lib/supabase/service');
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

  it('returns 503 when billing is not configured', async () => {
    vi.unstubAllEnvs();
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const { handleStripeWebhook } = await loadModule();
    const res = await handleStripeWebhook('{}', 't=1,v1=abc');
    expect(res.status).toBe(503);
  });
});
