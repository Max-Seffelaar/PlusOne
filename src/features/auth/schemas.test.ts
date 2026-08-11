import { describe, it, expect } from 'vitest';
import { emailSchema, otpSchema, inviteSchema, profileNameSchema, emailOtpTypeSchema } from './schemas';

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

// `EmailOtpType` (auth-js) is an open union (`... | (string & {})`), so
// `satisfies z.ZodType<EmailOtpType>` on the schema enforces nothing at
// compile time — a trimmed or misspelled list still typechecks. This pins
// the exact six values GoTrue accepts for link-based verification (consumed
// by auth/confirm/route.ts), so a drift (a 7th type added upstream, a typo)
// is caught here instead of silently narrowing what the route accepts.
describe('emailOtpTypeSchema', () => {
  const VALID = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

  it('accepts exactly the six link-verification types GoTrue supports', () => {
    for (const type of VALID) {
      expect(emailOtpTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects an unrecognized type, null, and a phone-OTP type (out of scope for this route)', () => {
    expect(emailOtpTypeSchema.safeParse('bogus').success).toBe(false);
    expect(emailOtpTypeSchema.safeParse(null).success).toBe(false);
    expect(emailOtpTypeSchema.safeParse('sms').success).toBe(false); // MobileOtpType, not EmailOtpType
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
  it('coerces a numeric quota and treats a blank one as undefined (#4)', () => {
    const withQuota = inviteSchema.safeParse({
      venueId: VENUE_ID, email: 'a@b.nl', roles: ['staff'], defaultQuota: '10',
    });
    expect(withQuota.success).toBe(true);
    if (withQuota.success) expect(withQuota.data.defaultQuota).toBe(10);

    const blank = inviteSchema.safeParse({
      venueId: VENUE_ID, email: 'a@b.nl', roles: ['staff'], defaultQuota: '',
    });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.defaultQuota).toBeUndefined();
  });
  it('rejects a negative quota', () => {
    expect(
      inviteSchema.safeParse({ venueId: VENUE_ID, email: 'a@b.nl', roles: ['staff'], defaultQuota: '-1' })
        .success
    ).toBe(false);
  });
});

describe('profileNameSchema', () => {
  it('trims and requires a non-empty name', () => {
    expect(profileNameSchema.parse({ fullName: '  Max  ' }).fullName).toBe('Max');
    expect(profileNameSchema.safeParse({ fullName: '   ' }).success).toBe(false);
  });
});
