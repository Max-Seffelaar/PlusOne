'use client';

/**
 * The event form's location block (z8uq9m2vqc, z8uq9m444c): saved-location
 * chips, the name and the Places-backed address. Saves with the form. Split
 * out of `edit.tsx` with the field-error wiring (z8uq9m5eb7) so the form stays
 * under the 800-LOC line.
 */
import type { JSX } from 'react';
import { t } from '@/lib/i18n';
import type { PoCompanyLocation } from '@/features/po/adapters';
import { LOCATION_ADDRESS_MAX, LOCATION_NAME_MAX } from '@/features/events/schemas';
import { Field, FieldErrorFor, Label, PlacesField, fieldInputProps, type FieldErrorBinding } from '../../kit';
import { LocationPicker } from './location-picker';

export function EventLocationFields({
  locations,
  name,
  address,
  onName,
  onAddress,
  errors,
}: {
  locations: readonly PoCompanyLocation[];
  name: string;
  address: string;
  /** Undefined = read-only (no chips, plain text). */
  onName?: (v: string) => void;
  onAddress?: (v: string) => void;
  errors?: { locationName?: FieldErrorBinding; locationAddress?: FieldErrorBinding };
}): JSX.Element {
  return (
    <>
      {/* Places (z8uq9m2vg5) on the address: one pick fills the name (if
          empty) and the address. */}
      <Label className="mb-2">{t.events.fieldLocation}</Label>
      {onName && onAddress && (
        <LocationPicker
          locations={locations}
          name={name}
          address={address}
          onPick={(copy) => {
            onName(copy.locationName);
            onAddress(copy.locationAddress);
          }}
        />
      )}
      <Field
        icon="building"
        ariaLabel={t.events.locationNameAria}
        placeholder={t.events.locationNamePlaceholder}
        value={name}
        onChange={onName}
        maxLength={LOCATION_NAME_MAX}
        className="mb-2"
        {...fieldInputProps(errors?.locationName)}
      />
      <FieldErrorFor error={errors?.locationName} />
      <PlacesField
        icon="pin"
        ariaLabel={t.events.locationAddressAria}
        placeholder={t.events.locationAddressPlaceholder}
        value={address}
        onChange={onAddress}
        onPick={(p) => {
          onAddress?.((p.address?.formattedAddress ?? p.label).slice(0, LOCATION_ADDRESS_MAX));
          if (!name.trim()) onName?.(p.name.slice(0, LOCATION_NAME_MAX));
        }}
        maxLength={LOCATION_ADDRESS_MAX}
        className="mb-2"
        {...fieldInputProps(errors?.locationAddress)}
      />
      <FieldErrorFor error={errors?.locationAddress} />
      <div className="mb-[18px] text-[12.5px] leading-[1.45] text-faint">{t.events.locationHint}</div>
    </>
  );
}
