/**
 * Resolve which event the mobile Deur/Taken tab should work.
 *
 * The /door/[eventId] route is per-event by URL, but the po surface's Deur/Taken
 * are tabs with no URL — so they resolve to the venue's "current" door event the
 * way a doorhost expects: a live event if one is running, otherwise the soonest
 * upcoming, otherwise the most recent still-open event. Cancelled events are never
 * a check-in target (#9/#26). Pure + tested so the tab can mount DoorProvider with
 * confidence (an empty id would throw in the snapshot fetch).
 *
 * "live" is now time-derived (event-phase.ts) — the manual status machine was
 * retired (24 jun 2026) — and "not a target" means cancelled, not status=closed.
 */
import type { PoEventRow } from './queries';
import { eventPhase, type EventPhase } from './event-phase';

export interface PoDoorEvent {
  id: string;
  name: string;
  venueName: string;
  /** Time-derived phase; drives the switcher's live hint + the cockpit badge. */
  phase: EventPhase;
  /** ISO start, for the auto-open window (start − 1h). */
  startsAt: string;
  endsAt: string | null;
}

function toDoorEvent(row: PoEventRow, nowMs: number): PoDoorEvent {
  return {
    id: row.id,
    name: row.name,
    venueName: row.venue_name,
    phase: eventPhase(row.starts_at, row.ends_at, nowMs),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
  };
}

/** How long before doors the cockpit starts auto-opening (T6: start − 1 uur). */
export const AUTO_OPEN_LEAD_MS = 60 * 60 * 1000;

/**
 * The event the desktop shell should auto-open the Event-day cockpit for on the
 * FIRST visit of a session (T6, decided 1/7): exactly ONE candidate inside its
 * door window (start − 1h through event end — candidates already exclude ended
 * events) → that event's id. Zero or several in-window (simultaneous nights) →
 * null: no guessing, the user lands normally.
 */
export function autoOpenDoorEvent(candidates: PoDoorEvent[], nowMs: number): string | null {
  const inWindow = candidates.filter((c) => {
    const start = Date.parse(c.startsAt);
    return !Number.isNaN(start) && nowMs >= start - AUTO_OPEN_LEAD_MS;
  });
  return inWindow.length === 1 ? inWindow[0].id : null;
}

/**
 * Every event the door/cockpit may work, ordered the way a switcher should show
 * them: live first, then soonest start. Cancelled events are read-only and never a
 * check-in target (#9/#26), and finished ("past") events are no door to work either
 * (Max, 7 jul 2026: the picker must only offer live/future events) — both are
 * dropped. Drives the Deur-tab event switcher (S1.3) — the user can deliberately
 * pick when several events are live. A past event stays reachable via its direct
 * /door/[eventId] URL if a late check-out is ever needed.
 */
export function doorCandidates(rows: PoEventRow[], nowMs: number): PoDoorEvent[] {
  const startMs = (r: PoEventRow): number => new Date(r.starts_at).getTime();
  const phase = (r: PoEventRow): EventPhase => eventPhase(r.starts_at, r.ends_at, nowMs);
  return rows
    .filter((r) => r.cancelled_at == null && phase(r) !== 'past')
    .sort((a, b) => {
      const live = (phase(a) === 'live' ? 0 : 1) - (phase(b) === 'live' ? 0 : 1);
      return live !== 0 ? live : startMs(a) - startMs(b);
    })
    .map((r) => toDoorEvent(r, nowMs));
}

export function pickDoorEvent(rows: PoEventRow[], nowMs: number): PoDoorEvent | null {
  if (rows.length === 0) return null;

  // Cancelled events are never a check-in target.
  const openish = rows.filter((r) => r.cancelled_at == null);
  if (openish.length === 0) return null;

  // A currently-live event always wins (the night that is actually happening).
  const live = openish.find((r) => eventPhase(r.starts_at, r.ends_at, nowMs) === 'live');
  if (live) return toDoorEvent(live, nowMs);

  const startMs = (r: PoEventRow): number => new Date(r.starts_at).getTime();

  // The soonest upcoming event (door prep before the night starts).
  const upcoming = openish.filter((r) => startMs(r) >= nowMs).sort((a, b) => startMs(a) - startMs(b));
  if (upcoming.length > 0) return toDoorEvent(upcoming[0], nowMs);

  // None upcoming: the most recent event that already started.
  const recent = [...openish].sort((a, b) => startMs(b) - startMs(a));
  return toDoorEvent(recent[0], nowMs);
}
