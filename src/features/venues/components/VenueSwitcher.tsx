'use client';

import { useRef } from 'react';
import { setActiveVenueAction } from '../actions';

export interface SwitcherVenue {
  venueId: string;
  venueName: string;
}

// Nav-level venue switcher for users who manage more than one venue (decision
// #1). Posts to setActiveVenueAction, which stores the choice in a cookie and
// revalidates the layout so every dashboard screen follows along. Renders
// nothing for single-venue users — there is nothing to switch.
export function VenueSwitcher({
  venues,
  activeVenueId,
}: {
  venues: SwitcherVenue[];
  activeVenueId: string | null;
}): JSX.Element | null {
  const formRef = useRef<HTMLFormElement>(null);
  if (venues.length <= 1) return null;

  return (
    <form ref={formRef} action={setActiveVenueAction}>
      <label htmlFor="venue-switcher" className="sr-only">
        Actieve venue
      </label>
      <select
        id="venue-switcher"
        name="venueId"
        defaultValue={activeVenueId ?? undefined}
        onChange={() => formRef.current?.requestSubmit()}
        className="field cursor-pointer py-1.5 text-sm"
      >
        {venues.map((v) => (
          <option key={v.venueId} value={v.venueId}>
            {v.venueName}
          </option>
        ))}
      </select>
    </form>
  );
}
