import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_IDS,
  DEFAULT_PLAN_ID,
  isPlanId,
  getPlan,
  planPriceLabel,
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
