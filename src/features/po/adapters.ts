import type { Guest, PoEvent, Tier, Role, GuestStatus, Priority, EventWhen, RecapGuest } from '@/lib/po/types';
import type { Database } from '@/lib/database.types';
import type { PoEventRow, PoGuestRow, PoTierRow, RecapGuestRow } from './queries';
import type { EventSummary, TierStat } from '@/features/stats/data';
import { formatClock } from '@/features/stats/format';
import { toPerTier, type PerTier } from '@/features/stats/po-adapter';

// Pure DB-row -> po-component-shape mappers (mirrors src/features/stats/po-adapter.ts).
// No I/O, so they're unit-tested directly (adapters.test.ts). The po mock types
// carry a few UI-only fields the core schema doesn't model — payment status (no
// ticketing, #10) and the door check-in time/by (those live in check_ins via the
// DoorProvider, #25). Those default here and get real values when the screens
// wire up (STAP 3.3+); cross-entity bits (a guest's role badge, who added it) are
// passed in by the caller so the mappers stay pure.

type EventStatus = Database['public']['Enums']['event_status'];
type NotePriority = Database['public']['Enums']['note_priority'];
type GuestRowStatus = Database['public']['Enums']['guest_status'];

const TZ = 'Europe/Amsterdam';

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...opts }).format(new Date(iso));
}
function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "draft/open/live" are upcoming; only a closed event is "past" (#9, #26). */
export function eventWhen(status: EventStatus): EventWhen {
  return status === 'closed' ? 'past' : 'upcoming';
}

/** A guest shows as "in" once checked in; everything else is still "wait". */
export function guestStatusToPo(status: GuestRowStatus): GuestStatus {
  return status === 'checked_in' ? 'in' : 'wait';
}

/** note_priority -> the po flag ("none" collapses to no flag). */
export function notePriorityToFlag(priority: NotePriority): Priority | null {
  return priority === 'high' ? 'high' : priority === 'low' ? 'low' : null;
}

/** Best-effort tier-name -> role badge, mirroring the mock's role labels. */
export function tierRole(name: string): Role {
  const n = name.toLowerCase();
  if (n.includes('vip')) return 'VIP';
  if (n.includes('artist') || n.includes('artiest')) return 'Artist';
  if (n.includes('access') || n === 'aa') return 'All Access';
  if (n.includes('pers') || n.includes('press')) return 'Pers';
  if (n.includes('crew')) return 'Crew';
  return 'Gast';
}

export interface EventCounts {
  /** Registered headcount (1 + plus-ones), aggregated by the caller. */
  guests: number;
  /** Present headcount (checked-in), aggregated by the caller. */
  inside: number;
}

export function toPoEvent(row: PoEventRow, counts: EventCounts): PoEvent {
  return {
    id: row.id,
    name: row.name,
    venue: row.venue_name,
    time: fmt(row.starts_at, { hour: '2-digit', minute: '2-digit', hour12: false }),
    date: fmt(row.starts_at, { day: '2-digit' }),
    mon: fmt(row.starts_at, { month: 'short' }).replace(/\W/g, '').toUpperCase(),
    month: capitalize(fmt(row.starts_at, { month: 'long', year: 'numeric' })),
    guests: counts.guests,
    inside: counts.inside,
    when: eventWhen(row.status),
  };
}

export interface GuestExtras {
  /** Role badge, resolved from the guest's tier by the caller. */
  role: Role;
  /** Display name of who added the guest (profiles join); '' when unknown. */
  addedBy?: string;
}

export function toPoGuest(row: PoGuestRow, extras: GuestExtras): Guest {
  return {
    id: row.id,
    name: row.full_name,
    role: extras.role,
    // Payment isn't modelled in the core schema (no ticketing, #10) — UI default.
    pay: 'free',
    plus: row.plus_ones,
    note: row.note ?? '',
    flag: notePriorityToFlag(row.note_priority),
    by: extras.addedBy ?? '',
    addedAt: fmt(row.created_at, { day: 'numeric', month: 'short' }).replace('.', ''),
    status: guestStatusToPo(row.status),
    // at/inBy come from check_ins (DoorProvider), not the guests row.
  };
}

/** A recap guest row → the po RecapGuest shape (role from tier, time from check-in). */
export function toRecapGuest(g: RecapGuestRow): RecapGuest {
  return {
    name: g.full_name,
    plus: g.plus_ones,
    role: tierRole(g.tierName ?? ''),
    at: g.checkedAt ? formatClock(g.checkedAt) : undefined,
    by: g.addedByName ?? undefined,
  };
}

/** The numbers + lists a past-event recap renders (event/venue/date come from the PoEvent). */
export interface PoRecap {
  /** On-list headcount. */
  listed: number;
  /** Present headcount. */
  arrived: number;
  noShow: number;
  refused: number;
  /** Peak 15-min bucket as "23:30", or "—" before the first check-in. */
  peak: string;
  checkedIn: RecapGuest[];
  noShows: RecapGuest[];
  perTier: PerTier[];
}

/**
 * Build the past-event recap from the summary RPC + on-list guests + per-tier
 * stats. "Ingecheckt" = checked-in (arrival order); "niet verschenen" = on the
 * list but never arrived (status approved). Pure → unit-tested.
 */
export function toRecap(
  summary: EventSummary | null,
  guests: RecapGuestRow[],
  tiers: TierStat[]
): PoRecap {
  const checkedIn = guests
    .filter((g) => g.status === 'checked_in')
    .sort((a, b) => (a.checkedAt ?? '').localeCompare(b.checkedAt ?? ''))
    .map(toRecapGuest);
  const noShows = guests.filter((g) => g.status === 'approved').map(toRecapGuest);
  return {
    listed: summary?.registered_headcount ?? 0,
    arrived: summary?.present_headcount ?? 0,
    noShow: summary?.no_shows ?? 0,
    refused: summary?.refused ?? 0,
    peak: summary?.peak_bucket ? formatClock(summary.peak_bucket) : '—',
    checkedIn,
    noShows,
    perTier: toPerTier(tiers),
  };
}

const DEFAULT_TIER_COLOR = '#B5A6FF';

export function toPoTier(row: PoTierRow, used: number): Tier {
  return {
    id: row.id,
    name: row.name,
    short: row.name,
    role: tierRole(row.name),
    color: row.color ?? DEFAULT_TIER_COLOR,
    max: row.max_guests,
    used,
    // Door price isn't modelled in the core schema (#10) — UI default.
    doorPrice: 0,
    aliases: row.aliases ?? [],
  };
}
