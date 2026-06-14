'use client';

import { useActionState } from 'react';
import { updateVenueSettingsAction, type ActionState } from '../actions';

const INITIAL: ActionState = { ok: false };

export interface VenueSettingsValues {
  name: string;
  retentionMonths: number;
  companyName: string | null;
  kvkNumber: string | null;
  vatNumber: string | null;
  financeEmail: string | null;
  addressLine: string | null;
  postalCode: string | null;
  city: string | null;
  country: string;
  defaultPersonalQuota: number;
}

// One labelled input. `disabled` is driven by the read-only (finance) case.
function TextField({
  id,
  label,
  defaultValue,
  disabled,
  type = 'text',
  placeholder,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  defaultValue: string | number;
  disabled: boolean;
  type?: string;
  placeholder?: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        defaultValue={defaultValue}
        disabled={disabled}
        placeholder={placeholder}
        className="field disabled:cursor-not-allowed disabled:opacity-60"
        {...rest}
      />
      {hint && <p className="text-faint text-xs">{hint}</p>}
    </div>
  );
}

// Venue settings: name + AVG retention + company/finance/address data + the
// venue-wide default personal quota (decision #16/#24). `canEdit` is false for
// finance (read-only, §2): fields render disabled and the save button is hidden.
// RLS (venues_update_admin) is the real guard either way.
export function VenueSettingsForm({
  venueId,
  values,
  canEdit,
}: {
  venueId: string;
  values: VenueSettingsValues;
  canEdit: boolean;
}): JSX.Element {
  const [state, formAction, pending] = useActionState(updateVenueSettingsAction, INITIAL);
  const d = !canEdit;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="venueId" value={venueId} />

      <section className="card flex flex-col gap-4">
        <h3 className="font-display text-sm font-bold">Algemeen</h3>
        <TextField id="name" label="Venuenaam" defaultValue={values.name} disabled={d} required maxLength={120} />
        <TextField
          id="retentionMonths"
          label="AVG-bewaartermijn (maanden)"
          type="number"
          defaultValue={values.retentionMonths}
          disabled={d}
          required
          min={1}
          max={60}
          step={1}
          hint="Na deze termijn worden gastgegevens automatisch geanonimiseerd (1–60 maanden)."
          className="field w-32 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </section>

      <section className="card flex flex-col gap-4">
        <h3 className="font-display text-sm font-bold">Bedrijfsgegevens</h3>
        <TextField id="companyName" label="Bedrijfsnaam" defaultValue={values.companyName ?? ''} disabled={d} placeholder="bv. Vesper Nightlife B.V." maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="kvkNumber" label="KvK-nummer" defaultValue={values.kvkNumber ?? ''} disabled={d} placeholder="12345678" inputMode="numeric" />
          <TextField id="vatNumber" label="BTW-nummer" defaultValue={values.vatNumber ?? ''} disabled={d} placeholder="NL000000000B00" />
        </div>
        <TextField id="financeEmail" label="E-mailadres financiën" type="email" defaultValue={values.financeEmail ?? ''} disabled={d} placeholder="facturen@venue.nl" inputMode="email" />
      </section>

      <section className="card flex flex-col gap-4">
        <h3 className="font-display text-sm font-bold">Adres</h3>
        <TextField id="addressLine" label="Straat + huisnummer" defaultValue={values.addressLine ?? ''} disabled={d} placeholder="Wibautstraat 150" maxLength={200} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField id="postalCode" label="Postcode" defaultValue={values.postalCode ?? ''} disabled={d} placeholder="1091 GR" />
          <TextField id="city" label="Plaats" defaultValue={values.city ?? ''} disabled={d} placeholder="Amsterdam" />
          <TextField id="country" label="Land" defaultValue={values.country} disabled={d} placeholder="NL" maxLength={56} />
        </div>
      </section>

      <section className="card flex flex-col gap-4">
        <h3 className="font-display text-sm font-bold">Standaard-quotum</h3>
        <TextField
          id="defaultPersonalQuota"
          label="Standaard gastenlijstplekken per persoon"
          type="number"
          defaultValue={values.defaultPersonalQuota}
          disabled={d}
          min={0}
          step={1}
          hint="Geldt voor leden zonder eigen toelage. Per persoon te overschrijven hieronder, en per event."
          className="field w-32 disabled:cursor-not-allowed disabled:opacity-60"
        />
      </section>

      {canEdit ? (
        <button type="submit" className="btn-primary self-start" disabled={pending}>
          {pending ? 'Bezig…' : 'Instellingen opslaan'}
        </button>
      ) : (
        <p className="text-faint text-xs">Alleen-lezen — financiën kan instellingen niet wijzigen.</p>
      )}

      {state.ok && state.message && (
        <p className="text-acc-soft text-sm" role="status">
          {state.message}
        </p>
      )}
      {!state.ok && state.error && (
        <p className="text-sm text-red-300" role="alert">
          {state.error}
        </p>
      )}
    </form>
  );
}
