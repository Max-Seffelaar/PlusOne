import { describe, it, expect } from 'vitest';
import { venueSettingsSchema, memberRolesSchema, removeMemberSchema } from './schemas';

const VENUE = 'aa000000-0000-7000-8000-000000000001';
const USER = '55555555-5555-4555-8555-555555555555';

describe('venueSettingsSchema', () => {
  it('accepts a valid name + retention and coerces the number', () => {
    const r = venueSettingsSchema.safeParse({ venueId: VENUE, name: ' Club Vesper ', retentionMonths: '12' });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('Club Vesper'); // trimmed
      expect(r.data.retentionMonths).toBe(12); // coerced to number
    }
  });
  it('rejects an empty name', () => {
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: '   ', retentionMonths: 12 }).success).toBe(false);
  });
  it('enforces the 1..60 retention bounds (matches the DB check)', () => {
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: 'X', retentionMonths: 0 }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: 'X', retentionMonths: 61 }).success).toBe(false);
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: 'X', retentionMonths: 1 }).success).toBe(true);
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: 'X', retentionMonths: 60 }).success).toBe(true);
  });
  it('rejects fractional months', () => {
    expect(venueSettingsSchema.safeParse({ venueId: VENUE, name: 'X', retentionMonths: 1.5 }).success).toBe(false);
  });
  it('rejects a non-uuid venue id', () => {
    expect(venueSettingsSchema.safeParse({ venueId: 'nope', name: 'X', retentionMonths: 12 }).success).toBe(false);
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
