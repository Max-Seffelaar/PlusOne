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

  // ── Switcher quick-create: optional company/billing fields + complete flag ──

  it('defaults the optional company fields and the complete flag when omitted', () => {
    const r = createVenueSchema.safeParse({ name: 'LOFI', venueType: 'club' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.complete).toBe(false); // wizard path
      expect(r.data.kvkNumber).toBeUndefined();
      expect(r.data.vatNumber).toBeUndefined();
      expect(r.data.financeEmail).toBeUndefined();
      expect(r.data.city).toBeUndefined();
    }
  });

  it('treats blank company fields as null (clean DB nulls)', () => {
    const r = createVenueSchema.safeParse({
      name: 'X',
      venueType: 'bar',
      city: '   ',
      kvkNumber: '',
      vatNumber: '',
      financeEmail: '',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.city).toBeNull();
      expect(r.data.kvkNumber).toBeNull();
      expect(r.data.vatNumber).toBeNull();
      expect(r.data.financeEmail).toBeNull();
    }
  });

  it('accepts a full company profile and lowercases the finance e-mail', () => {
    const r = createVenueSchema.safeParse({
      name: 'LOFI',
      venueType: 'club',
      city: 'Amsterdam',
      kvkNumber: '12345678',
      vatNumber: 'NL123456789B01',
      financeEmail: 'Facturen@Venue.NL',
      complete: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.city).toBe('Amsterdam');
      expect(r.data.kvkNumber).toBe('12345678');
      expect(r.data.financeEmail).toBe('facturen@venue.nl');
      expect(r.data.complete).toBe(true);
    }
  });

  it('rejects a KvK number that is not exactly 8 digits', () => {
    const base = { name: 'X', venueType: 'club' } as const;
    expect(createVenueSchema.safeParse({ ...base, kvkNumber: '1234567' }).success).toBe(false);
    expect(createVenueSchema.safeParse({ ...base, kvkNumber: '123456789' }).success).toBe(false);
    expect(createVenueSchema.safeParse({ ...base, kvkNumber: 'NL123456' }).success).toBe(false);
  });

  it('rejects an invalid finance e-mail', () => {
    const r = createVenueSchema.safeParse({ name: 'X', venueType: 'club', financeEmail: 'not-an-email' });
    expect(r.success).toBe(false);
  });

  it('defaults termsAccepted to false and accepts an explicit true (#40 consent)', () => {
    const a = createVenueSchema.safeParse({ name: 'X', venueType: 'club' });
    expect(a.success && a.data.termsAccepted).toBe(false);
    const b = createVenueSchema.safeParse({ name: 'X', venueType: 'club', termsAccepted: true });
    expect(b.success && b.data.termsAccepted).toBe(true);
  });
});
