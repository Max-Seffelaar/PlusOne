import { describe, it, expect } from 'vitest';
import { emailSchema, otpSchema, inviteSchema, profileNameSchema } from './schemas';

const VENUE_ID = '11111111-1111-4111-8111-111111111111';

describe('emailSchema', () => {
  it('trims and lowercases', () => {
    expect(emailSchema.parse('  Foo@Bar.NL ')).toBe('foo@bar.nl');
  });
  it('rejects invalid addresses', () => {
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
    expect(emailSchema.safeParse('').success).toBe(false);
  });
});

describe('otpSchema', () => {
  it('accepts exactly six digits', () => {
    expect(otpSchema.safeParse('123456').success).toBe(true);
  });
  it('rejects wrong length or non-digits', () => {
    expect(otpSchema.safeParse('12345').success).toBe(false);
    expect(otpSchema.safeParse('1234567').success).toBe(false);
    expect(otpSchema.safeParse('abcdef').success).toBe(false);
  });
});

describe('inviteSchema', () => {
  it('accepts a valid invite', () => {
    const r = inviteSchema.safeParse({ venueId: VENUE_ID, email: 'X@Y.nl', roles: ['staff'] });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.email).toBe('x@y.nl');
  });
  it('requires at least one role', () => {
    expect(inviteSchema.safeParse({ venueId: VENUE_ID, email: 'a@b.nl', roles: [] }).success).toBe(false);
  });
  it('rejects duplicate roles', () => {
    expect(
      inviteSchema.safeParse({ venueId: VENUE_ID, email: 'a@b.nl', roles: ['staff', 'staff'] }).success
    ).toBe(false);
  });
  it('rejects unknown roles', () => {
    expect(
      inviteSchema.safeParse({ venueId: VENUE_ID, email: 'a@b.nl', roles: ['superuser'] }).success
    ).toBe(false);
  });
  it('rejects an invalid venue id', () => {
    expect(inviteSchema.safeParse({ venueId: 'nope', email: 'a@b.nl', roles: ['staff'] }).success).toBe(
      false
    );
  });
});

describe('profileNameSchema', () => {
  it('trims and requires a non-empty name', () => {
    expect(profileNameSchema.parse({ fullName: '  Max  ' }).fullName).toBe('Max');
    expect(profileNameSchema.safeParse({ fullName: '   ' }).success).toBe(false);
  });
});
