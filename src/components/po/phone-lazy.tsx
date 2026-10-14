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
 *
 * METADATA: every entry point here is the `/max` build (86eyke279). The default
 * entry ships `min` metadata, which only knows each country's *length bands* —
 * it has no per-country numbering plan, so `isValidPhoneNumber('+3112345')`
 * returns TRUE and a five-digit non-number sailed through the landing form's
 * required phone field. `/max` carries the real plans and refuses it while
 * keeping both mobile (`+31612345678`) and landline (`+31201234567`) valid;
 * `/mobile` would wrongly reject the landline. The input, the country picker
 * and the validators must all resolve to the SAME metadata build — mixing them
 * bundles two metadata blobs AND lets the input format a number the validator
 * then rejects. Guarded by `tests/unit/phone-metadata-max.test.ts`.
 */
import { type JSX, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { fieldErrorBorder, fieldScrollMargin } from './field-error-style';
import dynamic from 'next/dynamic';
import type { Country } from 'react-phone-number-input';

export type CountryCode = Country;

/** Skeleton that mirrors the real country button's footprint (flag + dial +
 *  chevron) so the phone row keeps its exact geometry — no reflow, and the
 *  content fills in (rather than popping from empty) when the picker hydrates. */
function CountrySelectFallback(): JSX.Element {
  return (
    <div
      className="flex shrink-0 items-center gap-[6px] rounded-[9px] px-[5px] py-[5px]"
      aria-hidden
    >
      <span className="h-[15px] w-[20px] animate-pulse rounded-[3px] bg-elev2" />
      <span className="h-[12px] w-[22px] animate-pulse rounded bg-elev2" />
      <span className="h-[15px] w-[15px]" />
    </div>
  );
}

/** Holds the input's full width (flex-1) with a short loading bar, so the field
 *  neither collapses nor looks pre-filled before the input hydrates. */
function PhoneInputFallback(): JSX.Element {
  return (
    <span className="min-w-0 flex-1" aria-hidden>
      <span className="block h-[13px] w-[92px] animate-pulse rounded bg-elev2" />
    </span>
  );
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
  /** Passed through to the real <input> (field errors, z8uq9m5m8g). */
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

export const PhoneInput = dynamic<PhoneInputProps>(
  () => import('react-phone-number-input/input-max'),
  { ssr: false, loading: PhoneInputFallback },
);

/**
 * The po phone row: country picker + number in one field box, the same box
 * `Field` draws. Takes the kit's three error props (`id`, `invalid`,
 * `describedBy`, as `fieldInputProps(...)` hands them out): `id` and the aria
 * attributes land on the real input, `invalid` gives the box the red border,
 * and `data-field-shell` lets `focusAndReveal` centre the box (z8uq9m5m8g).
 * Changing the country clears the number (the old one was for another plan).
 */
export function PhoneField({
  country,
  onCountry,
  value,
  onChange,
  placeholder,
  className,
  id,
  invalid,
  describedBy,
}: {
  country: CountryCode;
  onCountry: (c: CountryCode) => void;
  value?: string;
  onChange: (value?: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  invalid?: boolean;
  describedBy?: string;
}): JSX.Element {
  return (
    <div
      data-field-shell
      className={cn(
        'flex items-center gap-[11px] rounded-[14px] border border-line bg-elev px-[11px] py-[13px] transition-colors focus-within:border-acc',
        fieldScrollMargin,
        invalid && fieldErrorBorder,
        className,
      )}
    >
      <CountrySelect
        value={country}
        onChange={(c) => {
          onCountry(c);
          onChange(undefined);
        }}
      />
      <span className="h-5 w-px shrink-0 bg-line" />
      <PhoneInput
        country={country}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="min-w-0 flex-1 border-none bg-transparent font-body text-[16px] text-text outline-none placeholder:text-faint"
      />
    </div>
  );
}

/** Validate an E.164 string against the full numbering plans (`/max`, see the
 *  METADATA note above). Defers the libphonenumber metadata: the phone chunk is
 *  already cached by the time a user submits, so this resolves instantly. */
export async function isPhoneValid(value: string): Promise<boolean> {
  const { isValidPhoneNumber } = await import('react-phone-number-input/max');
  return isValidPhoneNumber(value);
}

/** Derive the CountryCode of a stored E.164 number (for the initial flag), or
 *  `undefined` if it can't be parsed. Deferred like {@link isPhoneValid}. */
export async function phoneCountryOf(
  value: string | null | undefined,
): Promise<CountryCode | undefined> {
  if (!value) return undefined;
  try {
    const { parsePhoneNumber } = await import('react-phone-number-input/max');
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
