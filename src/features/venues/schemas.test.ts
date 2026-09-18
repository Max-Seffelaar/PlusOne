import { describe, it, expect } from 'vitest';
import { venueSettingsSchema, memberRolesSchema, removeMemberSchema } from './schemas';

const VENUE = 'aa000000-0000-7000-8000-000000000001';
const USER = '55555555-5555-4555-8555-555555555555';

// The form always submits every field (empty string when blank), so the schema
// requires them present; optional ones normalise '' -> null.
const baseVenue = {
  venueId: VENUE,
  name: 'Club Vesper',
  retentionMonths: 12,
  companyName: '',
  kvkNumber: '',
  vatNumber: '',
  financeEmail: '',
  addressLine: '',
  postalCode: '',
  city: '',
  country: '',
  website: '',
  defaultPersonalQuota: 0,
  allowUncheck: 'true',
};

describe('venueSettingsSchema', () => {
  it('accepts valid input, trims, coerces, and normalises blanks', () => {
    const r = venueSettingsSchema.safeParse({
      ...baseVenue,
      name: ' Club Vesper ',
      retentionMonths: '12',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('Club Vesper'); // trimmed
      expect(r.data.retentionMonths).toBe(12); // coerced
      expect(r.data.companyName).toBeNull(); // '' -> null
      expect(r.data.country).toBe('NL'); // '' -> default NL
    }
  });

  it('rejects an empty name', () => {
    expect(venueSettingsSchema.safeParse({ ...baseVenue, name: '   ' }).success).toBe(false);
  });

  it('enforces the 1..60 retention bounds (matches the DB check)', () => {
    expect(venueSettingsSchema.safeParse({ ...baseVenue, retentionMonths: 0 }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ ...baseVenue, retentionMonths: 61 }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ ...baseVenue, retentionMonths: 1 }).success).toBe(true);
  });

  it('validates KvK as 8 digits when provided, allows blank', () => {
    expect(venueSettingsSchema.safeParse({ ...baseVenue, kvkNumber: '1234567' }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ ...baseVenue, kvkNumber: '12345678' }).success).toBe(true);
    expect(venueSettingsSchema.safeParse({ ...baseVenue, kvkNumber: '' }).success).toBe(true);
  });

  it('validates + lowercases the finance e-mail, allows blank', () => {
    expect(venueSettingsSchema.safeParse({ ...baseVenue, financeEmail: 'nope' }).success).toBe(false);
    const r = venueSettingsSchema.safeParse({ ...baseVenue, financeEmail: 'Finance@Venue.NL' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.financeEmail).toBe('finance@venue.nl');
  });

  it('keeps a stored country as-is (legacy free text still saves)', () => {
    const r = venueSettingsSchema.safeParse({ ...baseVenue, country: 'Nederland' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.country).toBe('Nederland');
  });

  it('treats a blank website as null and trims a valid one', () => {
    const blank = venueSettingsSchema.safeParse({ ...baseVenue, website: '   ' });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.website).toBeNull();
    const ok = venueSettingsSchema.safeParse({ ...baseVenue, website: ' https://clubvesper.nl/agenda ' });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.website).toBe('https://clubvesper.nl/agenda');
    expect(venueSettingsSchema.safeParse({ ...baseVenue, website: 'http://clubvesper.nl' }).success).toBe(true);
  });

  it('accepts only an absolute http(s) website of at most 200 chars', () => {
    for (const bad of [
      'clubvesper.nl',
      'www.clubvesper.nl',
      'javascript:alert(1)',
      'ftp://clubvesper.nl',
      'https://',
      'https://localhost',
      `https://${'a'.repeat(190)}.nl`,
    ]) {
      const r = venueSettingsSchema.safeParse({ ...baseVenue, website: bad });
      expect(r.success, bad).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBeTruthy();
    }
  });

  it('rejects a negative default quota and coerces strings', () => {
    expect(venueSettingsSchema.safeParse({ ...baseVenue, defaultPersonalQuota: -1 }).success).toBe(false);
    const r = venueSettingsSchema.safeParse({ ...baseVenue, defaultPersonalQuota: '5' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.defaultPersonalQuota).toBe(5);
  });
});

describe('memberRolesSchema', () => {
  it('requires at least one role', () => {
    expect(memberRolesSchema.safeParse({ venueId: VENUE, userId: USER, roles: [] }).success).toBe(false);
  });
  it('dedupes and re-orders into canonical order', () => {
    const r = memberRolesSchema.safeParse({
      venueId: VENUE,
      userId: USER,
      roles: ['doorhost', 'staff', 'doorhost'],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.roles).toEqual(['staff', 'doorhost']);
  });
  it('rejects an unknown role', () => {
    expect(memberRolesSchema.safeParse({ venueId: VENUE, userId: USER, roles: ['owner'] }).success).toBe(false);
  });
});

describe('removeMemberSchema', () => {
  it('needs valid uuids for both ids', () => {
    expect(removeMemberSchema.safeParse({ venueId: VENUE, userId: USER }).success).toBe(true);
    expect(removeMemberSchema.safeParse({ venueId: VENUE, userId: 'x' }).success).toBe(false);
  });
});
