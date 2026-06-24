'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createEvent, updateEvent } from '../actions';
import type { AdminVenue } from '../queries';
import { DateTimeField } from './DateTimeField';
import { isoToLocalInput, localInputToIso } from '../datetime';

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
      setError('Enter a valid start date and time.');
      return;
    }
    const endIso = localInputToIso(endsAt);
    if (endsAt && !endIso) {
      setError('Enter a valid end date and time.');
      return;
    }
    if (endIso && endIso <= startIso) {
      setError('The end has to be after the start.');
      return;
    }

    startTransition(async () => {
      if (props.mode === 'create') {
        if (!venueId) {
          setError('Pick a venue.');
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
        <span className="label">Name</span>
        <input
          className="field"
          value={name}
          autoComplete="off"
          placeholder="e.g. PlusOne Launch Night"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1 text-sm">
          <span className="label">Doors open</span>
          <DateTimeField value={startsAt} onChange={setStartsAt} placeholder="Pick start" />
        </div>
        <div className="flex flex-1 flex-col gap-1 text-sm">
          <span className="label">
            End <span className="text-faint normal-case">(optional)</span>
          </span>
          <DateTimeField value={endsAt} onChange={setEndsAt} placeholder="Pick end" allowClear />
        </div>
      </div>
      <p className="text-faint text-xs">
        Event runs past midnight? Just enter the real end time. Everything hangs on the event, not
        the calendar day.
      </p>

      {isCreate && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-acc"
            checked={landingActive}
            onChange={(e) => setLandingActive(e.target.checked)}
          />
          Activate the request link right away
        </label>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={pending}
          onClick={submit}
        >
          {pending ? '…' : isCreate ? 'Create event' : 'Save event'}
        </button>
        {saved && <span className="text-acc text-sm">Saved.</span>}
      </div>

      {error && (
        <p className="text-acc-soft text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
