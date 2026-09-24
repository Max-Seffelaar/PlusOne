/**
 * The ONE country list (z8uq9m0hw2): English names keyed by their two-letter
 * code, sorted by name. Two consumers read it:
 *  - the venue settings Country dropdown, which offers `COUNTRIES` and stores
 *    the ISO 3166-1 alpha-2 code (`venues.country`, e.g. 'NL');
 *  - the phone field's country picker (`components/po/country-select.tsx`),
 *    which narrows `REGIONS` to the ones that have a calling code.
 *
 * Source: react-phone-number-input's English name table (`locale/en.json`,
 * ~6 kB raw). That file is names only, with no libphonenumber metadata and no
 * flag SVGs, which is why this module may import it statically while the rest
 * of that package stays behind the lazy phone boundary. The exception is pinned
 * to this one file, and to that one subpath, by
 * `tests/unit/phone-lazy-imports.test.ts`.
 */
import enNames from 'react-phone-number-input/locale/en.json';

export interface CountryEntry {
  /** Two-letter region code, upper case ('NL'). */
  code: string;
  /** English display name ('Netherlands'). */
  name: string;
}

const NAMES = enNames as Record<string, string>;

/** 'ZZ' is the table's "International" pseudo region, not a place. */
const NOT_A_REGION: ReadonlySet<string> = new Set(['ZZ']);

/** Named regions that are not ISO 3166-1 alpha-2 country codes: AC (Ascension
 *  Island) and TA (Tristan da Cunha) are only "exceptionally reserved" (both are
 *  part of SH), XA/XO (Abkhazia, South Ossetia) are this name table's own.
 *  The phone picker keeps AC/TA because they have calling codes; a venue's
 *  country never offers them. XK (Kosovo) stays: user-assigned, but it is the
 *  code the EU and Stripe use. */
const NOT_ISO_3166: ReadonlySet<string> = new Set(['AC', 'TA', 'XA', 'XO']);

/** Every named region, sorted by English name. The phone picker's base list. */
export const REGIONS: readonly CountryEntry[] = Object.keys(NAMES)
  .filter((code) => /^[A-Z]{2}$/.test(code) && !NOT_A_REGION.has(code))
  .map((code) => ({ code, name: NAMES[code] ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

/** ISO 3166-1 alpha-2 countries, sorted by English name. The venue country list. */
export const COUNTRIES: readonly CountryEntry[] = REGIONS.filter((c) => !NOT_ISO_3166.has(c.code));

const REGION_NAMES: ReadonlyMap<string, string> = new Map(REGIONS.map((c) => [c.code, c.name]));

/** English name for any named region code, or null when the table has none. */
export function countryName(code: string): string | null {
  return REGION_NAMES.get(code) ?? null;
}
