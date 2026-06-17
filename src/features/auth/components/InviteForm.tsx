'use client';

import { useActionState, useEffect, useRef } from 'react';
import { inviteUserAction, type ActionState } from '../invite-actions';
import { VENUE_ROLES, ROLE_LABELS, type VenueRole } from '../roles';

const INITIAL: ActionState = { ok: false };

export function InviteForm({
  venueId,
  callerIsAdmin,
}: {
  venueId: string;
  callerIsAdmin: boolean;
}): JSX.Element {
  const [state, formAction, pending] = useActionState(inviteUserAction, INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Clear the form after a successful invite (the pending list re-renders via
  // revalidatePath).
  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state.ok, state.message]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="venueId" value={venueId} />

      <div className="flex flex-col gap-2">
        <label htmlFor="invite-email" className="label">
          E-mailadres
        </label>
        <input
          id="invite-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          required
          placeholder="nieuwe-collega@venue.nl"
          className="field"
        />
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="label mb-1">Rollen</legend>
        <div className="grid grid-cols-2 gap-2">
          {VENUE_ROLES.map((role: VenueRole) => {
            const disabled = role === 'admin' && !callerIsAdmin;
            return (
              <label
                key={role}
                className={`flex items-center gap-2 rounded-field border px-3 py-2 text-sm transition-colors ${
                  disabled ? 'border-line2 text-faint cursor-not-allowed' : 'border-line text-text hover:border-acc cursor-pointer'
                }`}
              >
                <input
                  type="checkbox"
                  name="roles"
                  value={role}
                  disabled={disabled}
                  className="accent-acc"
                />
                {ROLE_LABELS[role]}
              </label>
            );
          })}
        </div>
        {!callerIsAdmin && (
          <p className="text-faint text-xs">Alleen een beheerder kan de rol Beheerder toekennen.</p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <label htmlFor="invite-quota" className="label">
          Quotum per event <span className="text-faint">(optioneel)</span>
        </label>
        <input
          id="invite-quota"
          name="defaultQuota"
          type="number"
          min={0}
          max={9999}
          inputMode="numeric"
          placeholder="bijv. 10"
          className="field"
        />
        <p className="text-faint text-xs">
          Aantal gastenplekken dat dit teamlid per event mag vullen. Leeg laten = de standaard van de venue.
        </p>
      </div>

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? 'Bezig…' : 'Uitnodiging versturen'}
      </button>

      {state.ok && state.message && (
        <p className="text-acc-soft text-sm" role="status">
          {state.message} De persoon logt in op <span className="font-semibold">/login</span> met dit
          e-mailadres; de eerste code-login activeert het account.
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
