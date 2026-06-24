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
