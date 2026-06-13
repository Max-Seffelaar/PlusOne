import { describe, it, expect } from 'vitest';
import { defaultQuotaSchema, quotaRequestSchema } from './schemas';

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
