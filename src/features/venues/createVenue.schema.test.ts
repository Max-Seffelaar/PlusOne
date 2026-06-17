import { describe, it, expect } from 'vitest';
import { createVenueSchema, VENUE_TYPES } from './schemas';

describe('createVenueSchema (#40a self-service venue creation)', () => {
  it('accepts a valid venue and applies defaults', () => {
    const r = createVenueSchema.safeParse({ name: 'LOFI', venueType: 'club' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('LOFI');
      expect(r.data.retentionMonths).toBe(12); // default
      expect(r.data.address).toBe(''); // default
    }
  });

  it('trims the name and rejects an empty one', () => {
    expect(createVenueSchema.safeParse({ name: '   ', venueType: 'club' }).success).toBe(false);
    const r = createVenueSchema.safeParse({ name: '  LOFI  ', venueType: 'bar' });
    expect(r.success && r.data.name).toBe('LOFI');
  });

  it('rejects an unknown venue type', () => {
    expect(createVenueSchema.safeParse({ name: 'X', venueType: 'stadium' }).success).toBe(false);
  });

  it('accepts every known venue type', () => {
    for (const t of VENUE_TYPES) {
      expect(createVenueSchema.safeParse({ name: 'X', venueType: t }).success).toBe(true);
    }
  });

  it('enforces retention bounds (1..60)', () => {
    const base = { name: 'X', venueType: 'club' } as const;
    expect(createVenueSchema.safeParse({ ...base, retentionMonths: 0 }).success).toBe(false);
    expect(createVenueSchema.safeParse({ ...base, retentionMonths: 61 }).success).toBe(false);
    expect(createVenueSchema.safeParse({ ...base, retentionMonths: 24 }).success).toBe(true);
  });

  it('coerces a numeric string for retention', () => {
    const r = createVenueSchema.safeParse({ name: 'X', venueType: 'club', retentionMonths: '6' });
    expect(r.success && r.data.retentionMonths).toBe(6);
  });
});
