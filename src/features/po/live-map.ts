/**
 * Pure row → prototype-view mappers + NL formatters.
 *
 * The polished `po` screens render the view types in `src/lib/po/types.ts`
 * (PoEvent, Guest, Tier, …). The live data layer fetches Supabase rows and maps
 * them onto those exact shapes, so the screens stay untouched (CLAUDE.md design
 * rule: replace the data, preserve the component API). These functions are pure
 * so the mapping is unit-testable without a database.
 */
import type { Database } from '@/lib/database.types';
import type { PoEvent, Tier, Role } from '@/lib/po/types';

type EventRow = Database['public']['Tables']['events']['Row'];
type TierRow = Database['public']['Tables']['guest_tiers']['Row'];

const TZ = 'Europe/Amsterdam';

function fmt(d: Date, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('nl-NL', { timeZone: TZ, ...opts }).format(d);
}

/** Date chips for the events list: "20", "JUN", "Juni 2026", "23:00". */
export function eventDateParts(startsAt: string): {
  date: string;
  mon: string;
  month: string;
  time: string;
} {
  const d = new Date(startsAt);
  const monthLong = fmt(d, { month: 'long', year: 'numeric' }); // "juni 2026"
  return {
    date: fmt(d, { day: '2-digit' }),
    mon: fmt(d, { month: 'short' }).replace('.', '').toUpperCase(), // "jun." → "JUN"
    month: monthLong.charAt(0).toUpperCase() + monthLong.slice(1), // "Juni 2026"
    time: fmt(d, { hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

export interface EventCounts {
  guests: number;
  inside: number;
}

/** Aggregate the (RLS-scoped) guest rows a user can see into per-event counts. */
export function aggregateGuestCounts(
  rows: { event_id: string; status: string; plus_ones: number }[],
): Map<string, EventCounts> {
  const out = new Map<string, EventCounts>();
  for (const g of rows) {
    if (g.status === 'removed') continue; // soft-deleted never counts (#21)
    const c = out.get(g.event_id) ?? { guests: 0, inside: 0 };
    c.guests += 1;
    if (g.status === 'checked_in') c.inside += 1;
    out.set(g.event_id, c);
  }
  return out;
}

export function toPoEvent(
  e: EventRow,
  venueName: string,
  counts: EventCounts | undefined,
  now: Date,
): PoEvent {
  const parts = eventDateParts(e.starts_at);
  const endRef = new Date(e.ends_at ?? e.starts_at);
  return {
    id: e.id,
    name: e.name,
    venue: venueName,
    time: parts.time,
    date: parts.date,
    mon: parts.mon,
    month: parts.month,
    guests: counts?.guests ?? 0,
    inside: counts?.inside ?? 0,
    accent: e.status === 'live',
    when: endRef.getTime() < now.getTime() ? 'past' : 'upcoming',
  };
}

// The prototype's Role union is a fixed example set; real tiers are free-form
// per event (#8). We map a tier name onto the closest Role for icon/colour
// purposes only — the tier's own name/colour remain authoritative.
function roleForTier(name: string): Role {
  const n = name.toLowerCase();
  if (n.includes('vip')) return 'VIP';
  if (n.includes('access') || n.includes('backstage')) return 'All Access';
  if (n.includes('artist') || n.includes('dj') || n.includes('act')) return 'Artist';
  if (n.includes('pers') || n.includes('press') || n.includes('media')) return 'Pers';
  if (n.includes('crew') || n.includes('prod')) return 'Crew';
  return 'Gast';
}

/** Map a guest_tiers row onto the prototype Tier shape. `used` is supplied by
 *  the caller (it needs a count query); pass 0 when not yet known. */
export function toPoTier(t: TierRow, used = 0, isDefault = false): Tier {
  return {
    id: t.id,
    name: t.name,
    short: t.name.length > 12 ? t.name.slice(0, 12) : t.name,
    role: roleForTier(t.name),
    color: t.color ?? '#8E8E93',
    max: t.max_guests,
    used,
    doorPrice: 0, // door price hangs on the tier (#34); column lands with billing
    aliases: t.aliases ?? [],
    isDefault,
  };
}
