// Time-derived event phase (Upcoming / Live / Past).
//
// Feedback (Joeri/Max, 24 jun 2026): the manual status machine (draft/open/live/
// closed) was retired. The phase a user sees is now computed purely from the
// event's start/end time relative to now — so a finished event can never show
// "Upcoming" or keep blinking "Live". Pure + `now` injected, so it's deterministic
// in tests and stable across SSR/CSR (same discipline as daysUntilEvent /
// amsterdamHour). Mirrors nothing in the DB: `events.status` is vestigial; this is
// the single source of truth for the DISPLAYED phase.

import type { EventWhen, EventPhase } from '@/lib/po/types';

export type { EventPhase };

/** Club nights routinely have no explicit end time. Treat the event as "live" for
 *  this long after the start so a 23:00 door reads as live through the night, then
 *  rolls to "past" the next morning. Only used when ends_at is null. */
export const LIVE_GRACE_MS = 8 * 60 * 60 * 1000;

/**
 * Upcoming = starts in the future. Live = started and not yet ended (or within the
 * grace window when no end is set). Past = ended (or grace elapsed). Comparisons
 * are on absolute instants — never day-bucketed — so an event that crosses
 * midnight is classified correctly (#26).
 */
export function eventPhase(startsAt: string, endsAt: string | null, nowMs: number): EventPhase {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) return 'upcoming';
  if (nowMs < start) return 'upcoming';

  const end = endsAt ? Date.parse(endsAt) : NaN;
  const effectiveEnd = Number.isNaN(end) ? start + LIVE_GRACE_MS : end;
  return nowMs <= effectiveEnd ? 'live' : 'past';
}

/** Collapse the three-way phase to the Events tab's two buckets: a live event is
 *  still "upcoming" (it's tonight, not history). */
export function eventWhenFromPhase(phase: EventPhase): EventWhen {
  return phase === 'past' ? 'past' : 'upcoming';
}

/**
 * The event an "Add guest" flow starts on when the user hasn't picked one
 * (z8uq9m0hw3, item 1): the requested event if it exists, otherwise the SOONEST
 * upcoming-or-live event. Never a past one: with nothing upcoming this returns
 * undefined and the screen shows its "no upcoming events" state.
 *
 * `events` must be newest-first (usePoEvents' order, starts_at desc), so the
 * soonest upcoming event is the LAST upcoming one. The old pick took the first
 * upcoming (the furthest away) and then fell back to the first event overall,
 * which on a venue with nothing upcoming was the most recent PAST event.
 */
export function defaultAddGuestEvent<E extends { id: string; when: EventWhen }>(
  events: readonly E[],
  requestedId?: string,
): E | undefined {
  const requested = requestedId ? events.find((e) => e.id === requestedId) : undefined;
  if (requested) return requested;
  const upcoming = events.filter((e) => e.when === 'upcoming');
  return upcoming[upcoming.length - 1];
}
