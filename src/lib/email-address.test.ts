/**
 * The one address rule for mail headers (review #456 S1, N3): invisible and
 * control characters are refused, an IDN domain becomes punycode, and the
 * three schemas that use it agree.
 */
import { describe, expect, it } from 'vitest';
import { EMAIL_ADDRESS_RE, normalizeEmailAddress } from './email-address';
import { contactEmailField } from '@/features/events/schemas';
import { companyContactSchema } from '@/features/venues/contact-schema';

const INVISIBLE = [
  ['a zero-width space', 'a\u200bb@club.nl'],
  ['a bidi override', 'a\u202eb@club.nl'],
  ['a control character', 'a\u0001b@club.nl'],
  ['a byte-order mark', 'a\ufeffb@club.nl'],
  ['a soft hyphen', 'a\u00adb@club.nl'],
  ['a non-ASCII local part', 'jos\u00e9@club.nl'],
] as const;

describe('EMAIL_ADDRESS_RE', () => {
  it('takes a plain address and a punycode domain', () => {
    expect(EMAIL_ADDRESS_RE.test('night@club.nl')).toBe(true);
    expect(EMAIL_ADDRESS_RE.test('info@xn--caf-dma.nl')).toBe(true);
  });

  it.each(INVISIBLE)('refuses %s', (_name, value) => {
    expect(EMAIL_ADDRESS_RE.test(value)).toBe(false);
  });

  it('still refuses header syntax', () => {
    expect(EMAIL_ADDRESS_RE.test('a@b.c>, x@y.z')).toBe(false);
    expect(EMAIL_ADDRESS_RE.test('a b@club.nl')).toBe(false);
  });
});

describe('normalizeEmailAddress', () => {
  it('trims, lower-cases and turns an IDN domain into punycode', () => {
    expect(normalizeEmailAddress('  Info@Caf\u00e9.NL ')).toBe('info@xn--caf-dma.nl');
  });

  it('never lets URL parsing reinterpret the domain', () => {
    expect(normalizeEmailAddress('a@caf\u00e9.nl/evil.com')).toBe('a@caf\u00e9.nl/evil.com');
    expect(EMAIL_ADDRESS_RE.test(normalizeEmailAddress('a@caf\u00e9.nl/evil.com'))).toBe(false);
  });
});

describe('the schemas use the same rule', () => {
  it.each(INVISIBLE)('event and company address refuse %s', (_name, value) => {
    expect(contactEmailField.safeParse(value).success).toBe(false);
    const company = companyContactSchema.safeParse({
      venueId: '00000000-0000-7000-8000-000000000001',
      contactEmail: value,
      channels: { phone: '', instagram: '', facebook: '', snapchat: '', tiktok: '' },
      guestConfirmationDefault: true,
    });
    expect(company.success).toBe(false);
  });

  it('an IDN domain is stored as punycode', () => {
    expect(contactEmailField.parse('info@caf\u00e9.nl')).toBe('info@xn--caf-dma.nl');
  });
});
