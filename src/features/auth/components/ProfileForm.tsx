'use client';

import { useActionState } from 'react';
import { updateProfileAction, updateEmailAction, type ActionState } from '../profile-actions';

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
  currentFirstName,
  currentLastName,
  currentPhone,
  currentEmail,
}: {
  currentFirstName: string;
  currentLastName: string;
  currentPhone: string;
  currentEmail: string;
}): JSX.Element {
  const [profileState, profileAction, profilePending] = useActionState(updateProfileAction, INITIAL);
  const [emailState, emailAction, emailPending] = useActionState(updateEmailAction, INITIAL);

  return (
    <div className="flex flex-col gap-6">
      <form action={profileAction} className="card flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="firstName" className="label">
              Voornaam
            </label>
            <input id="firstName" name="firstName" type="text" defaultValue={currentFirstName} required maxLength={80} className="field" />
          </div>
          <div className="flex flex-col gap-2">
            <label htmlFor="lastName" className="label">
              Achternaam
            </label>
            <input id="lastName" name="lastName" type="text" defaultValue={currentLastName} required maxLength={120} className="field" />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="phone" className="label">
            Telefoonnummer
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={currentPhone}
            placeholder="+31 6 12345678"
            maxLength={40}
            className="field"
          />
        </div>
        <button type="submit" className="btn-primary self-start" disabled={profilePending}>
          {profilePending ? 'Bezig…' : 'Profiel opslaan'}
        </button>
        <Result state={profileState} />
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
