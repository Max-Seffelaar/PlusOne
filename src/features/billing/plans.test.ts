import { describe, it, expect } from 'vitest';
import {
  PLAN_IDS,
  PLAN_ID,
  PLAN_NAME,
  isPlanId,
  isBillingInterval,
  effectiveTrialEndsAt,
  formatPriceAmount,
  yearlySavingsPercent,
  billingBlockReason,
} from './plans';

describe('the one plan (Billing G)', () => {
  it('is Pro, and only Pro', () => {
    expect(PLAN_IDS).toEqual(['pro']);
    expect(PLAN_ID).toBe('pro');
    expect(PLAN_NAME).toBe('Pro');
    expect(isPlanId('pro')).toBe(true);
    for (const legacy of ['indie', 'premium', 'pilot', 'basic', '', null, 42]) {
      expect(isPlanId(legacy)).toBe(false);
    }
  });

  it('knows exactly two intervals', () => {
    expect(isBillingInterval('month')).toBe(true);
    expect(isBillingInterval('year')).toBe(true);
    expect(isBillingInterval('week')).toBe(false);
    expect(isBillingInterval(null)).toBe(false);
  });
});

describe('effectiveTrialEndsAt — coalesce(trial_ends_at, created_at + 14 d)', () => {
  it('defaults to created_at + 14 days', () => {
    expect(effectiveTrialEndsAt('2026-10-01T10:00:00Z').toISOString()).toBe('2026-10-15T10:00:00.000Z');
    expect(effectiveTrialEndsAt('2026-10-01T10:00:00Z', null).toISOString()).toBe('2026-10-15T10:00:00.000Z');
  });

  it('takes the override when set, earlier or later', () => {
    expect(effectiveTrialEndsAt('2026-10-01T10:00:00Z', '2026-12-31T22:59:59Z').toISOString()).toBe(
      '2026-12-31T22:59:59.000Z'
    );
    expect(effectiveTrialEndsAt('2026-10-01T10:00:00Z', '2026-10-03T00:00:00Z').toISOString()).toBe(
      '2026-10-03T00:00:00.000Z'
    );
  });
});

describe('prices (amounts come from Stripe, never from code)', () => {
  const month = { interval: 'month' as const, unitAmount: 4900, currency: 'eur' };
  const year = { interval: 'year' as const, unitAmount: 47040, currency: 'eur' };

  it('formats euro amounts, dropping whole cents', () => {
    expect(formatPriceAmount(month)).toBe('€49');
    expect(formatPriceAmount({ unitAmount: 3950, currency: 'eur' })).toBe('€39.50');
    expect(formatPriceAmount({ unitAmount: 4900, currency: 'usd' })).toBe('49 USD');
  });

  it('computes the yearly saving from the two prices', () => {
    expect(yearlySavingsPercent({ month, year })).toBe(20);
  });

  it('has no saving when a price is missing, currencies differ or yearly is not cheaper', () => {
    expect(yearlySavingsPercent(null)).toBeNull();
    expect(yearlySavingsPercent({ month, year: null })).toBeNull();
    expect(yearlySavingsPercent({ month: null, year })).toBeNull();
    expect(yearlySavingsPercent({ month, year: { ...year, currency: 'usd' } })).toBeNull();
    expect(yearlySavingsPercent({ month, year: { ...year, unitAmount: 58800 } })).toBeNull();
  });
});

describe('billingBlockReason (soft-block, #32 refinement)', () => {
  const NOW = new Date('2026-07-20T12:00:00Z');
  const fresh = '2026-07-10T00:00:00Z'; // trial ends 24 Jul — still running
  const lapsed = '2026-07-01T00:00:00Z'; // trial ended 15 Jul — lapsed

  it('never blocks active/comped/past_due (dunning owns past_due)', () => {
    for (const status of ['active', 'past_due', 'comped'] as const) {
      expect(
        billingBlockReason({ status, createdAt: lapsed, trialEndsAt: null, stripeSubscriptionId: null }, NOW)
      ).toBeNull();
    }
  });

  it('blocks a canceled venue', () => {
    expect(
      billingBlockReason({ status: 'canceled', createdAt: fresh, trialEndsAt: null, stripeSubscriptionId: 'sub_x' }, NOW)
    ).toBe('canceled');
  });

  it('does not block a running trial', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: fresh, trialEndsAt: null, stripeSubscriptionId: null }, NOW)
    ).toBeNull();
  });

  it('blocks a lapsed trial without checkout', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: lapsed, trialEndsAt: null, stripeSubscriptionId: null }, NOW)
    ).toBe('trial_expired');
  });

  it('leaves a lapsed trial WITH a Stripe subscription to Stripe (trial_end)', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: lapsed, trialEndsAt: null, stripeSubscriptionId: 'sub_x' }, NOW)
    ).toBeNull();
  });

  it('flips exactly at the 14-day boundary', () => {
    const createdAt = '2026-07-06T12:00:00Z';
    const justBefore = new Date('2026-07-20T11:59:59Z');
    const justAfter = new Date('2026-07-20T12:00:01Z');
    const sub = { status: 'trialing' as const, createdAt, trialEndsAt: null, stripeSubscriptionId: null };
    expect(billingBlockReason(sub, justBefore)).toBeNull();
    expect(billingBlockReason(sub, justAfter)).toBe('trial_expired');
  });

  // Billing G: the platform-admin override (subscriptions.trial_ends_at) is the
  // trial end when set — server gate and UI read the same coalesce.
  it('a later override keeps a lapsed-by-default trial open', () => {
    expect(
      billingBlockReason(
        { status: 'trialing', createdAt: lapsed, trialEndsAt: '2026-08-01T00:00:00Z', stripeSubscriptionId: null },
        NOW
      )
    ).toBeNull();
  });

  it('an earlier override blocks a trial that would still run by default', () => {
    expect(
      billingBlockReason(
        { status: 'trialing', createdAt: fresh, trialEndsAt: '2026-07-19T00:00:00Z', stripeSubscriptionId: null },
        NOW
      )
    ).toBe('trial_expired');
  });
});
