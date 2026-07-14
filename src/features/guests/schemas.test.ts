import { describe, it, expect } from 'vitest';
import { addOnSpotSchema } from './schemas';

// The door outbox replay inserts add_guest payloads directly with no server
// action re-validating them (86ey9e8bd) — addOnSpotSchema is the only Zod
// gate on that path, so it must actually enforce the same caps as every
// other guest write.
describe('addOnSpotSchema', () => {
  const TIER_ID = '11111111-1111-4111-8111-111111111111';

  it('accepts a normal door-add payload', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: 2, tierId: TIER_ID });
    expect(r.success).toBe(true);
  });

  it('accepts plusOnes at the exact cap (50)', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: 50, tierId: TIER_ID });
    expect(r.success).toBe(true);
  });

  it('rejects plusOnes just above the cap', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: 51, tierId: TIER_ID });
    expect(r.success).toBe(false);
  });

  it('rejects a runaway plusOnes value (the door-add bypass scenario)', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: 9999999, tierId: TIER_ID });
    expect(r.success).toBe(false);
  });

  it('rejects a negative plusOnes value', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: -1, tierId: TIER_ID });
    expect(r.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const r = addOnSpotSchema.safeParse({ fullName: '', plusOnes: 0, tierId: TIER_ID });
    expect(r.success).toBe(false);
  });

  it('rejects a non-uuid tierId', () => {
    const r = addOnSpotSchema.safeParse({ fullName: 'Anna', plusOnes: 0, tierId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });
});
