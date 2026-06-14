import { describe, it, expect } from 'vitest';
import { retentionSchema } from './schemas';

const VENUE = '11111111-1111-4111-8111-111111111111';

describe('retentionSchema', () => {
  it('accepts the allowed range (1, default 12, max 60)', () => {
    for (const m of [1, 6, 12, 24, 60]) {
      expect(retentionSchema.safeParse({ venueId: VENUE, retentionMonths: m }).success).toBe(true);
    }
  });

  it('rejects below the 1-month minimum and above the 60-month cap', () => {
    expect(retentionSchema.safeParse({ venueId: VENUE, retentionMonths: 0 }).success).toBe(false);
    expect(retentionSchema.safeParse({ venueId: VENUE, retentionMonths: 61 }).success).toBe(false);
  });

  it('rejects non-integers and malformed venue ids', () => {
    expect(retentionSchema.safeParse({ venueId: VENUE, retentionMonths: 12.5 }).success).toBe(false);
    expect(retentionSchema.safeParse({ venueId: 'not-a-uuid', retentionMonths: 12 }).success).toBe(false);
  });

  it('coerces a form-submitted numeric string', () => {
    const r = retentionSchema.safeParse({ venueId: VENUE, retentionMonths: '24' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.retentionMonths).toBe(24);
  });
});
