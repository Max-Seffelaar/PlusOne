'use client';

import { useActionState } from 'react';
import { updateVenueSettingsAction, type ActionState } from '../actions';

const INITIAL: ActionState = { ok: false };

// Venue name + AVG retention (decision #16/#24). `canEdit` is false for finance
// (read-only, §2): the fields render disabled and the save button is hidden.
// RLS (venues_update_admin) is the real guard either way.
export function VenueSettingsForm({
  venueId,
  name,
  retentionMonths,
  canEdit,
}: {
  venueId: string;
  name: string;
  retentionMonths: number;
  canEdit: boolean;
}): JSX.Element {
  const [state, formAction, pending] = useActionState(updateVenueSettingsAction, INITIAL);

  return (
    <form action={formAction} className="card flex flex-col gap-4">
      <input type="hidden" name="venueId" value={venueId} />

      <div className="flex flex-col gap-2">
        <label htmlFor="venue-name" className="label">
          Venuenaam
        </label>
        <input
          id="venue-name"
          name="name"
          type="text"
          defaultValue={name}
          required
          maxLength={120}
          disabled={!canEdit}
          className="field disabled:cursor-not-allowed disabled:opacity-60"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="retention" className="label">
          AVG-bewaartermijn (maanden)
        </label>
        <input
          id="retention"
          name="retentionMonths"
          type="number"
          inputMode="numeric"
          min={1}
          max={60}
          step={1}
          defaultValue={retentionMonths}
          required
          disabled={!canEdit}
          className="field w-32 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <p className="text-faint text-xs">
          Na deze termijn worden gastgegevens automatisch geanonimiseerd (1–60 maanden).
        </p>
      </div>

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
