'use client';

/**
 * Lazy phone-field primitives (#B4, task 86ey9e8z5).
 *
 * `react-phone-number-input/flags` (all country-flag SVGs) + libphonenumber
 * metadata are ~102 kB gz / 436 kB raw. Statically imported they landed in the
 * First Load of the public guest pages (`/e`, `/r`, `/consent`) and `/app` — so
 * an anonymous guest paid ~100 kB for one OPTIONAL phone field. These wrappers
 * pull the heavy pieces into their own async chunk (the daypicker pattern in
 * `datetime-field.tsx`), loaded only once a phone field actually renders.
 *
 * ALL phone consumers import `CountrySelect` / `PhoneInput` / the validators from
 * HERE, never from `react-phone-number-input` directly — a vitest guard
 * (`tests/unit/phone-lazy-imports.test.ts`) enforces it so the deps can never
 * creep back into a First Load graph. Capacitor-safe (#37): pure client, no
 * browser-only global touched at import time.
 */
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Country } from 'react-phone-number-input';

export type CountryCode = Country;

/** Fixed-footprint placeholder for the country button (flag + dial + chevron) so
 *  the phone row doesn't reflow when the real picker hydrates. */
function CountrySelectFallback(): JSX.Element {
  return <span className="inline-block h-[27px] w-[58px] shrink-0" aria-hidden />;
}

export const CountrySelect = dynamic(
  () => import('./country-select').then((m) => m.CountrySelect),
  { ssr: false, loading: CountrySelectFallback },
);

/** Props actually used across the phone consumers. The `/input` build ships no
 *  types (input.d.ts is empty), so the real default export is `any` — this keeps
 *  call sites type-checked. `value`/`onChange` mirror the library's E.164 string. */
type PhoneInputProps = {
  country?: Country;
  value?: string;
  onChange: (value?: string) => void;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
};

export const PhoneInput = dynamic<PhoneInputProps>(
  () => import('react-phone-number-input/input'),
  { ssr: false, loading: () => <div className="min-w-0 flex-1" aria-hidden /> },
);

/** Validate an E.164 string. Defers the libphonenumber metadata: the phone chunk
 *  is already cached by the time a user submits, so this resolves instantly. */
export async function isPhoneValid(value: string): Promise<boolean> {
  const { isValidPhoneNumber } = await import('react-phone-number-input');
  return isValidPhoneNumber(value);
}

/** Derive the CountryCode of a stored E.164 number (for the initial flag), or
 *  `undefined` if it can't be parsed. Deferred like {@link isPhoneValid}. */
export async function phoneCountryOf(
  value: string | null | undefined,
): Promise<CountryCode | undefined> {
  if (!value) return undefined;
  try {
    const { parsePhoneNumber } = await import('react-phone-number-input');
    return parsePhoneNumber(value)?.country as CountryCode | undefined;
  } catch {
    return undefined;
  }
}

/**
 * Edit-form country state: starts at NL and upgrades to the stored number's
 * country once {@link phoneCountryOf} resolves the deferred metadata — so an
 * edit sheet no longer statically imports libphonenumber just to pick the
 * initial flag. Returns `[country, setCountry]`; the form still drives changes.
 */
export function useStoredPhoneCountry(
  storedPhone: string | null | undefined,
): [CountryCode, (c: CountryCode) => void] {
  const [country, setCountry] = useState<CountryCode>('NL');
  useEffect(() => {
    let alive = true;
    void phoneCountryOf(storedPhone).then((c) => {
      if (alive && c) setCountry(c);
    });
    return () => {
      alive = false;
    };
  }, [storedPhone]);
  return [country, setCountry];
}
