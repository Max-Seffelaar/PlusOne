import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_IDS,
  DEFAULT_PLAN_ID,
  isPlanId,
  getPlan,
  planPriceLabel,
  billingBlockReason,
} from './plans';

describe('plan catalog', () => {
  it('exposes the three onboarding plans in catalog order', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['indie', 'premium', 'pro']);
    expect(PLAN_IDS).toEqual(['indie', 'premium', 'pro']);
  });

  it('marks exactly one plan as popular and it is the default', () => {
    const popular = PLANS.filter((p) => p.popular);
    expect(popular).toHaveLength(1);
    expect(popular[0]?.id).toBe(DEFAULT_PLAN_ID);
  });

  it('gives every plan at least one feature', () => {
    for (const p of PLANS) expect(p.features.length).toBeGreaterThan(0);
  });
});

describe('isPlanId', () => {
  it('accepts known plan ids', () => {
    expect(isPlanId('indie')).toBe(true);
    expect(isPlanId('premium')).toBe(true);
    expect(isPlanId('pro')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isPlanId('enterprise')).toBe(false);
    expect(isPlanId('')).toBe(false);
    expect(isPlanId(null)).toBe(false);
    expect(isPlanId(42)).toBe(false);
  });
});

describe('getPlan / planPriceLabel', () => {
  it('returns the plan by id', () => {
    expect(getPlan('premium').name).toBe('Premium');
  });

  it('throws on an unknown id', () => {
    // @ts-expect-error — exercising the runtime guard with a bad id
    expect(() => getPlan('nope')).toThrow();
  });

  it('formats price labels', () => {
    expect(planPriceLabel(getPlan('indie'))).toBe('Free');
    expect(planPriceLabel(getPlan('premium'))).toBe('€49/mo');
    expect(planPriceLabel(getPlan('pro'))).toBe('On request');
  });
});

describe('billingBlockReason (soft-block, #32 refinement)', () => {
  const NOW = new Date('2026-07-20T12:00:00Z');
  const fresh = '2026-07-10T00:00:00Z'; // trial ends 24 Jul — still running
  const lapsed = '2026-07-01T00:00:00Z'; // trial ended 15 Jul — lapsed

  it('never blocks active/comped/past_due (dunning owns past_due)', () => {
    for (const status of ['active', 'past_due', 'comped'] as const) {
      expect(
        billingBlockReason({ status, createdAt: lapsed, stripeSubscriptionId: null }, NOW)
      ).toBeNull();
    }
  });

  it('blocks a canceled venue', () => {
    expect(
      billingBlockReason({ status: 'canceled', createdAt: fresh, stripeSubscriptionId: 'sub_x' }, NOW)
    ).toBe('canceled');
  });

  it('does not block a running trial', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: fresh, stripeSubscriptionId: null }, NOW)
    ).toBeNull();
  });

  it('blocks a lapsed trial without checkout', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: lapsed, stripeSubscriptionId: null }, NOW)
    ).toBe('trial_expired');
  });

  it('leaves a lapsed trial WITH a Stripe subscription to Stripe (trial_end)', () => {
    expect(
      billingBlockReason({ status: 'trialing', createdAt: lapsed, stripeSubscriptionId: 'sub_x' }, NOW)
    ).toBeNull();
  });

  it('flips exactly at the 14-day boundary', () => {
    const createdAt = '2026-07-06T12:00:00Z';
    const justBefore = new Date('2026-07-20T11:59:59Z');
    const justAfter = new Date('2026-07-20T12:00:01Z');
    const sub = { status: 'trialing' as const, createdAt, stripeSubscriptionId: null };
    expect(billingBlockReason(sub, justBefore)).toBeNull();
    expect(billingBlockReason(sub, justAfter)).toBe('trial_expired');
  });
});
