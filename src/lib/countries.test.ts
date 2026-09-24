/**
 * The shared country list (z8uq9m0hw2): venue settings' Country dropdown and
 * the phone field's country picker read the SAME list. These pin what each of
 * them gets out of it.
 */
import { describe, expect, it } from 'vitest';
import { getCountries } from 'react-phone-number-input/max';
import { COUNTRIES, REGIONS, countryName } from './countries';
import { phoneCountries } from '@/components/po/country-select';

const codes = (list: readonly { code: string }[]): string[] => list.map((c) => c.code);

describe('COUNTRIES (venue country dropdown)', () => {
  it('holds upper-case two-letter codes with English names', () => {
    for (const c of COUNTRIES) {
      expect(c.code, c.name).toMatch(/^[A-Z]{2}$/);
      expect(c.name.length, c.code).toBeGreaterThan(1);
    }
    expect(COUNTRIES.find((c) => c.code === 'NL')?.name).toBe('Netherlands');
    expect(COUNTRIES.find((c) => c.code === 'BE')?.name).toBe('Belgium');
    expect(COUNTRIES.find((c) => c.code === 'DE')?.name).toBe('Germany');
  });

  it('is sorted by English name and has no duplicates', () => {
    const names = COUNTRIES.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(new Set(codes(COUNTRIES)).size).toBe(COUNTRIES.length);
  });

  it('covers every ISO 3166-1 country, not only the ones with a calling code', () => {
    // 249 officially assigned codes + XK (Kosovo).
    expect(COUNTRIES.length).toBe(250);
    for (const code of ['AQ', 'BV', 'GS', 'HM', 'PN', 'TF', 'UM', 'XK']) {
      expect(codes(COUNTRIES), code).toContain(code);
    }
  });

  it('never offers a pseudo region or a non-ISO code', () => {
    for (const code of ['ZZ', 'XA', 'XO', 'AC', 'TA']) {
      expect(codes(COUNTRIES), code).not.toContain(code);
    }
  });
});

describe('the phone picker narrows the same list', () => {
  it('offers exactly the regions libphonenumber can dial, in the shared order', () => {
    const phone = phoneCountries();
    expect(new Set(codes(phone))).toEqual(new Set(getCountries()));
    expect(phone.length).toBe(getCountries().length);
    // Same names + order as the shared list: nothing re-sorted or re-labelled.
    const shared = REGIONS.filter((r) => phone.some((p) => p.code === r.code));
    expect(phone.map((p) => [p.code, p.name])).toEqual(shared.map((r) => [r.code, r.name]));
  });

  it('keeps the dial-only regions a venue never gets', () => {
    const phone = codes(phoneCountries());
    expect(phone).toContain('AC');
    expect(phone).toContain('TA');
    expect(phoneCountries().find((c) => c.code === 'NL')?.dial).toBe('31');
  });
});

describe('countryName', () => {
  it('names a region code and returns null for anything else', () => {
    expect(countryName('NL')).toBe('Netherlands');
    expect(countryName('AC')).toBe('Ascension Island');
    expect(countryName('ZZ')).toBeNull();
    expect(countryName('nl')).toBeNull();
    expect(countryName('Netherlands')).toBeNull();
    expect(countryName('ext')).toBeNull();
  });
});
