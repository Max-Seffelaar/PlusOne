import { describe, it, expect } from 'vitest';
import { toE164, isValidEmail, DIAL_CODES, DEFAULT_DIAL_CODE } from './phone';

describe('toE164', () => {
  it('treats an empty national number as "not provided"', () => {
    expect(toE164('+31', '')).toEqual({ ok: true, empty: true });
    expect(toE164('+31', '   ')).toEqual({ ok: true, empty: true });
  });

  it('normalises a Dutch 06 number to E.164, stripping the trunk 0 and spaces', () => {
    expect(toE164('+31', '06 12 34 56 78')).toEqual({ ok: true, empty: false, e164: '+31612345678' });
    expect(toE164('+31', '0612345678')).toEqual({ ok: true, empty: false, e164: '+31612345678' });
    expect(toE164('+31', '06-12-34-56-78')).toEqual({ ok: true, empty: false, e164: '+31612345678' });
  });

  it('rejects a too-short NL number with a friendly reason', () => {
    const r = toE164('+31', '06 123');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/telefoonnummer/i);
  });

  it('accepts foreign numbers on a loose length check', () => {
    expect(toE164('+49', '0151 23456789')).toEqual({ ok: true, empty: false, e164: '+4915123456789' });
    expect(toE164('+44', '07911 123456')).toEqual({ ok: true, empty: false, e164: '+447911123456' });
  });

  it('rejects a number with no digits', () => {
    expect(toE164('+31', 'geen nummer').ok).toBe(false);
  });

  it('rejects an absurdly long foreign number', () => {
    expect(toE164('+1', '1234567890123456789').ok).toBe(false);
  });

  it('ships NL as the default dial code', () => {
    expect(DEFAULT_DIAL_CODE).toBe('+31');
    expect(DIAL_CODES.some((d) => d.code === '+31' && d.iso === 'NL')).toBe(true);
  });
});

describe('isValidEmail', () => {
  it('accepts well-formed addresses', () => {
    expect(isValidEmail('jip@voorbeeld.nl')).toBe(true);
    expect(isValidEmail('  a.b@c.co  ')).toBe(true);
  });

  it('rejects malformed ones', () => {
    expect(isValidEmail('nope')).toBe(false);
    expect(isValidEmail('a@b')).toBe(false);
    expect(isValidEmail('a @b.nl')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
