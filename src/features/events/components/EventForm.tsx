'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEvent, updateEvent } from '../actions';
import type { AdminVenue } from '../queries';

// datetime-local <-> ISO. The input is wall-clock in the admin's browser TZ
// (Europe/Amsterdam for NL venues); an event 23:00→05:00 becomes two full
// instants and crosses midnight by construction (#26).
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

type Props =
  | { mode: 'create'; venues: AdminVenue[] }
  | {
      mode: 'edit';
      event: { id: string; name: string; startsAt: string; endsAt: string | null };
    };

export function EventForm(props: Props): JSX.Element {
  const router = useRouter();
  const isCreate = props.mode === 'create';

  const [venueId, setVenueId] = useState(isCreate ? (props.venues[0]?.venueId ?? '') : '');
  const [name, setName] = useState(isCreate ? '' : props.event.name);
  const [startsAt, setStartsAt] = useState(isCreate ? '' : isoToLocalInput(props.event.startsAt));
  const [endsAt, setEndsAt] = useState(isCreate ? '' : isoToLocalInput(props.event.endsAt));
  const [landingActive, setLandingActive] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setSaved(false);

    const startIso = localInputToIso(startsAt);
    if (!startIso) {
      setError('Vul een geldige startdatum en -tijd in.');
      return;
    }
    const endIso = localInputToIso(endsAt);
    if (endsAt && !endIso) {
      setError('Vul een geldige einddatum en -tijd in.');
      return;
    }
    if (endIso && endIso <= startIso) {
      setError('Het einde moet ná de start liggen.');
      return;
    }

    startTransition(async () => {
      if (props.mode === 'create') {
        if (!venueId) {
          setError('Kies een venue.');
          return;
        }
        const res = await createEvent({
          venueId,
          name,
          startsAt: startIso,
          endsAt: endIso,
          landingActive,
        });
        if (res.ok) router.push(`/events/${res.eventId}`);
        else setError(res.message);
      } else {
        const res = await updateEvent({
          eventId: props.event.id,
          name,
          startsAt: startIso,
          endsAt: endIso,
        });
        if (res.ok) setSaved(true);
        else setError(res.message);
      }
    });
  }

  return (
    <div className="card flex flex-col gap-4">
      {isCreate && props.venues.length > 1 && (
        <label className="flex flex-col gap-1 text-sm">
          <span className="label">Venue</span>
          <select className="field" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            {props.venues.map((v) => (
              <option key={v.venueId} value={v.venueId}>
                {v.venueName}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="flex flex-col gap-1 text-sm">
        <span className="label">Naam</span>
        <input
          className="field"
          value={name}
          placeholder="bv. PLUSONE Launch Night"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="label">Start (deur open)</span>
          <input
            type="datetime-local"
            className="field"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="label">
            Einde <span className="text-faint normal-case">(optioneel)</span>
          </span>
          <input
            type="datetime-local"
            className="field"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
          />
        </label>
      </div>
      <p className="text-faint text-xs">
        Loopt het event over middernacht? Vul gewoon de echte eindtijd in — alles hangt aan het
        event, niet de kalenderdag.
      </p>

      {isCreate && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-acc"
            checked={landingActive}
            onChange={(e) => setLandingActive(e.target.checked)}
          />
          Aanvraaglink meteen activeren
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={pending}
          onClick={submit}
        >
          {pending ? '…' : isCreate ? 'Event aanmaken' : 'Opslaan'}
        </button>
        {saved && <span className="text-acc text-sm">Opgeslagen.</span>}
      </div>

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
