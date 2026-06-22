/**
 * Resolve which event the mobile Deur/Taken tab should work.
 *
 * The /door/[eventId] route is per-event by URL, but the po surface's Deur/Taken
 * are tabs with no URL — so they resolve to the venue's "current" door event the
 * way a doorhost expects: a live event if one is running, otherwise the soonest
 * upcoming, otherwise the most recent still-open event. Closed events are never
 * a check-in target (#9/#26). Pure + tested so the tab can mount DoorProvider
 * with confidence (an empty id would throw in the snapshot fetch).
 */
import type { PoEventRow } from './queries';
import type { Database } from '@/lib/database.types';

type EventStatus = Database['public']['Enums']['event_status'];

export interface PoDoorEvent {
  id: string;
  name: string;
  venueName: string;
  status: EventStatus;
}

function toDoorEvent(row: PoEventRow): PoDoorEvent {
  return { id: row.id, name: row.name, venueName: row.venue_name, status: row.status };
}

/**
 * Every event the door/cockpit may work, ordered the way a switcher should show
 * them: live first, then soonest start. Closed events are read-only history and
 * never a check-in target (#9/#26), so they are dropped. Drives the Deur-tab event
 * switcher (S1.3) — the user can deliberately pick when several events are live.
 */
export function doorCandidates(rows: PoEventRow[]): PoDoorEvent[] {
  const startMs = (r: PoEventRow): number => new Date(r.starts_at).getTime();
  return rows
    .filter((r) => r.status !== 'closed')
    .sort((a, b) => {
      const live = (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1);
      return live !== 0 ? live : startMs(a) - startMs(b);
    })
    .map(toDoorEvent);
}

export function pickDoorEvent(rows: PoEventRow[], nowMs: number): PoDoorEvent | null {
  if (rows.length === 0) return null;

  // A currently-live event always wins (the night that is actually happening).
  const live = rows.find((r) => r.status === 'live');
  if (live) return toDoorEvent(live);

  // Closed events are read-only history — never a check-in target.
  const openish = rows.filter((r) => r.status !== 'closed');
  if (openish.length === 0) return null;

  const startMs = (r: PoEventRow): number => new Date(r.starts_at).getTime();

  // The soonest upcoming event (door prep before the night starts).
  const upcoming = openish.filter((r) => startMs(r) >= nowMs).sort((a, b) => startMs(a) - startMs(b));
  if (upcoming.length > 0) return toDoorEvent(upcoming[0]);

  // None upcoming: the most recent still-open event (started, not yet closed).
  const recent = [...openish].sort((a, b) => startMs(b) - startMs(a));
  return toDoorEvent(recent[0]);
}
