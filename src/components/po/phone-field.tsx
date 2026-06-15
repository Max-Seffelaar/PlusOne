'use client';

/** Shared phone input: a searchable country-code picker + E.164 number field.
 *  Reused across the app (profile, guest forms) so every phone field collects a
 *  number WITH an explicit dial code — the exact control the public landing form
 *  uses, lifted out of `landing.tsx` so there is one source of truth. */
import { useState } from 'react';
import PhoneInput from 'react-phone-number-input/input';
import { parsePhoneNumber } from 'react-phone-number-input';
import { cn } from '@/lib/utils';
import { CountrySelect, type CountryCode } from './country-select';

export function PhoneField({
  value,
  onChange,
  defaultCountry = 'NL',
  invalid = false,
  className,
}: {
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  defaultCountry?: CountryCode;
  invalid?: boolean;
  className?: string;
}): JSX.Element {
  // The flag follows the stored number's country (so a saved +49… shows 🇩🇪),
  // falling back to the default when the field is empty or unparseable.
  const [country, setCountry] = useState<CountryCode>(() => {
    if (value) {
      try {
        return parsePhoneNumber(value)?.country ?? defaultCountry;
      } catch {
        return defaultCountry;
      }
    }
    return defaultCountry;
  });
  return (
    <div
      className={cn(
        'flex items-center gap-[8px] rounded-[14px] border bg-elev py-[10px] pl-[9px] pr-[15px] transition-colors focus-within:border-acc',
        invalid ? 'border-acc' : 'border-line',
        className,
      )}
    >
      <CountrySelect
        value={country}
        onChange={(c) => {
          if (c !== country) {
            setCountry(c);
            onChange(undefined); // re-type the number for the newly chosen country
          }
        }}
      />
      <span className="h-5 w-px shrink-0 bg-line" />
      <PhoneInput
        country={country}
        value={value}
        onChange={onChange}
        aria-label="Telefoonnummer"
        placeholder="6 12 34 56 78"
        className="min-w-0 flex-1 border-none bg-transparent text-[16px] text-text outline-none placeholder:text-faint"
      />
    </div>
  );
}
