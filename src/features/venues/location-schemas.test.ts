// z8uq9m444c — saved company locations: the Zod bounds mirror the DB CHECKs
// (migration 20261013160000) so a formatted copy always fits the event column.
import { describe, expect, it } from 'vitest';
import {
  archiveCompanyLocationSchema,
  createCompanyLocationSchema,
  updateCompanyLocationSchema,
} from './location-schemas';

const VENUE = '0190e000-0000-7000-8000-000000000001';

describe('createCompanyLocationSchema', () => {
  it('trims and turns empty parts into null', () => {
    const r = createCompanyLocationSchema.parse({
      venueId: VENUE,
      name: '  Paradiso ',
      addressLine: ' Weteringschans 6 ',
      postalCode: '',
      city: 'Amsterdam',
      country: '',
    });
    expect(r).toMatchObject({ name: 'Paradiso', addressLine: 'Weteringschans 6', postalCode: null, city: 'Amsterdam', country: null });
  });

  it('refuses a blank name, an over-long part and a bad id', () => {
    const base = { venueId: VENUE, name: 'X', addressLine: '', postalCode: '', city: '', country: '' };
    expect(createCompanyLocationSchema.safeParse({ ...base, name: '   ' }).success).toBe(false);
    expect(createCompanyLocationSchema.safeParse({ ...base, addressLine: 'a'.repeat(121) }).success).toBe(false);
    expect(createCompanyLocationSchema.safeParse({ ...base, postalCode: '1'.repeat(17) }).success).toBe(false);
    expect(createCompanyLocationSchema.safeParse({ ...base, city: 'c'.repeat(61) }).success).toBe(false);
    expect(createCompanyLocationSchema.safeParse({ ...base, venueId: 'not-a-uuid' }).success).toBe(false);
  });

  it('the longest allowed parts still format within the 200-char event address', () => {
    const r = createCompanyLocationSchema.parse({
      venueId: VENUE,
      name: 'X',
      addressLine: 'a'.repeat(120),
      postalCode: 'p'.repeat(16),
      city: 'c'.repeat(60),
      country: '',
    });
    const formatted = `${r.addressLine}, ${r.postalCode} ${r.city}`;
    expect(formatted.length).toBeLessThanOrEqual(200);
  });
});

describe('update / archive', () => {
  it('need a location uuid', () => {
    expect(updateCompanyLocationSchema.safeParse({ locationId: 'x', name: 'A', addressLine: '', postalCode: '', city: '', country: '' }).success).toBe(false);
    expect(archiveCompanyLocationSchema.safeParse({ locationId: VENUE }).success).toBe(true);
    expect(archiveCompanyLocationSchema.safeParse({ locationId: '' }).success).toBe(false);
  });
});
