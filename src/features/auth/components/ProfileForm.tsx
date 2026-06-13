'use client';

import { useActionState } from 'react';
import { updateNameAction, updateEmailAction, type ActionState } from '../profile-actions';

const INITIAL: ActionState = { ok: false };

function Result({ state }: { state: ActionState }): JSX.Element | null {
  if (state.ok && state.message)
    return (
      <p className="text-acc-soft text-sm" role="status">
        {state.message}
      </p>
    );
  if (!state.ok && state.error)
    return (
      <p className="text-sm text-red-300" role="alert">
        {state.error}
      </p>
    );
  return null;
}

export function ProfileForm({
  currentName,
  currentEmail,
}: {
  currentName: string;
  currentEmail: string;
}): JSX.Element {
  const [nameState, nameAction, namePending] = useActionState(updateNameAction, INITIAL);
  const [emailState, emailAction, emailPending] = useActionState(updateEmailAction, INITIAL);

  return (
    <div className="flex flex-col gap-6">
      <form action={nameAction} className="card flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="fullName" className="label">
            Naam
          </label>
          <input
            id="fullName"
            name="fullName"
            type="text"
            defaultValue={currentName}
            required
            maxLength={120}
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={namePending}>
          {namePending ? 'Bezig…' : 'Naam opslaan'}
        </button>
        <Result state={nameState} />
      </form>

      <form action={emailAction} className="card flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="label">
            E-mailadres
          </label>
          <input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            defaultValue={currentEmail}
            required
            className="field"
          />
          <p className="text-faint text-xs">
            Alleen jij kunt je eigen e-mailadres wijzigen. Je bevestigt de wijziging via een link in
            je huidige én nieuwe inbox.
          </p>
        </div>
        <button type="submit" className="btn-dark self-start" disabled={emailPending}>
          {emailPending ? 'Bezig…' : 'E-mailadres wijzigen'}
        </button>
        <Result state={emailState} />
      </form>
    </div>
  );
}
