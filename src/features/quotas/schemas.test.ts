import { describe, it, expect } from 'vitest';
import { defaultQuotaSchema, markQuotaRequestSeenSchema, quotaRequestSchema } from './schemas';

const VENUE = 'aa000000-0000-7000-8000-000000000001';
const USER = '55555555-5555-4555-8555-555555555555';

describe('defaultQuotaSchema', () => {
  it('accepts 0 and coerces string input', () => {
    const r = defaultQuotaSchema.safeParse({ venueId: VENUE, userId: USER, defaultCount: '0' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.defaultCount).toBe(0);
  });
  it('accepts a normal allowance', () => {
    const r = defaultQuotaSchema.safeParse({ venueId: VENUE, userId: USER, defaultCount: 10 });
    expect(r.success).toBe(true);
  });
  it('rejects negative counts (matches the DB check >= 0)', () => {
    expect(defaultQuotaSchema.safeParse({ venueId: VENUE, userId: USER, defaultCount: -1 }).success).toBe(false);
  });
  it('rejects fractional counts', () => {
    expect(defaultQuotaSchema.safeParse({ venueId: VENUE, userId: USER, defaultCount: 2.5 }).success).toBe(false);
  });
  it('rejects a non-uuid user id', () => {
    expect(defaultQuotaSchema.safeParse({ venueId: VENUE, userId: 'x', defaultCount: 1 }).success).toBe(false);
  });
});

// Light coverage of the Fase-7 request schema alongside the new one, so this
// suite documents the whole quotas input surface in one place.
describe('quotaRequestSchema', () => {
  it('requires a motivation and at least one extra slot', () => {
    expect(
      quotaRequestSchema.safeParse({ eventId: VENUE, requestedExtra: 0, motivation: 'x' }).success
    ).toBe(false);
    expect(
      quotaRequestSchema.safeParse({ eventId: VENUE, requestedExtra: 2, motivation: '' }).success
    ).toBe(false);
    expect(
      quotaRequestSchema.safeParse({ eventId: VENUE, requestedExtra: 2, motivation: 'Gastenlijst vrienden' })
        .success
    ).toBe(true);
  });
});

// z8uq9m2xyp: the guest a request names — same bounds as the DB CHECK.
describe('quotaRequestSchema · guest', () => {
  const TIER = 'dd000000-0000-7000-8000-000000000002';
  const base = { eventId: VENUE, requestedExtra: 2, motivation: 'Birthday' };
  const ok = (guest: Record<string, unknown>) => quotaRequestSchema.safeParse({ ...base, guest }).success;

  it('is optional', () => {
    expect(quotaRequestSchema.safeParse(base).success).toBe(true);
  });
  it('accepts a name, +N and a tier, phone/note optional', () => {
    expect(ok({ name: 'Lisa de Vries', plusOnes: 1, tierId: TIER })).toBe(true);
    expect(ok({ name: 'Lisa de Vries', plusOnes: 0, tierId: TIER, phone: '+31612345678', note: 'Birthday' })).toBe(true);
  });
  it('turns an empty phone into null', () => {
    const r = quotaRequestSchema.safeParse({ ...base, guest: { name: 'Lisa', plusOnes: 0, tierId: TIER, phone: '' } });
    expect(r.success && r.data.guest?.phone).toBe(null);
  });
  it('rejects negative, fractional or more than 50 plus-ones', () => {
    expect(ok({ name: 'Lisa', plusOnes: -1, tierId: TIER })).toBe(false);
    expect(ok({ name: 'Lisa', plusOnes: 1.5, tierId: TIER })).toBe(false);
    expect(ok({ name: 'Lisa', plusOnes: 51, tierId: TIER })).toBe(false);
  });
  it('rejects a blank name and a non-uuid tier', () => {
    expect(ok({ name: '   ', plusOnes: 0, tierId: TIER })).toBe(false);
    expect(ok({ name: 'Lisa', plusOnes: 0, tierId: 'backstage' })).toBe(false);
  });
});

describe('markQuotaRequestSeenSchema', () => {
  it('takes one request uuid', () => {
    expect(markQuotaRequestSeenSchema.safeParse({ requestId: 'dd000000-0000-7000-8000-000000000002' }).success).toBe(true);
    expect(markQuotaRequestSeenSchema.safeParse({ requestId: 'x' }).success).toBe(false);
  });
});
