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
  /** Time-derived phase; drives the switcher's "· live" / "· open" hint. */
  phase: EventPhase;
}

function toDoorEvent(row: PoEventRow, nowMs: number): PoDoorEvent {
  return {
    id: row.id,
    name: row.name,
    venueName: row.venue_name,
    phase: eventPhase(row.starts_at, row.ends_at, nowMs),
  };
}

/**
 * Every event the door/cockpit may work, ordered the way a switcher should show
 * them: live first, then soonest start. Cancelled events are read-only and never a
 * check-in target (#9/#26), so they are dropped. Drives the Deur-tab event switcher
 * (S1.3) — the user can deliberately pick when several events are live.
 */
export function doorCandidates(rows: PoEventRow[], nowMs: number): PoDoorEvent[] {
  const startMs = (r: PoEventRow): number => new Date(r.starts_at).getTime();
  const isLive = (r: PoEventRow): boolean => eventPhase(r.starts_at, r.ends_at, nowMs) === 'live';
  return rows
    .filter((r) => r.cancelled_at == null)
    .sort((a, b) => {
      const live = (isLive(a) ? 0 : 1) - (isLive(b) ? 0 : 1);
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
