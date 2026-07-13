/**
 * Pure derivation for the desktop Event-dag cockpit (S13).
 *
 * The cockpit screen (EventDayCockpit) stays declarative: every number and filter
 * it renders comes from these pure functions, mirroring how `src/features/door/
 * model.ts` keeps the door's logic testable in isolation (no I/O, injectable
 * `now`). Headcount math is the canonical M4 selector (`../headcount.ts`, spec
 * #44) — this file adapts the cockpit's `Guest[]` + arrivals-map shape onto it,
 * it never re-derives on-list/inside/on-the-way itself (K-10: two independent
 * reducers here and in door/model.ts is exactly what let the two drift apart).
 */
import { fuzzyMatch } from '@/features/door/components/fuzzy';
import type { Guest, GuestStatus, Tier } from '@/lib/po/types';
import { computeHeadcounts, heads as headsOf, type HeadcountRow } from '../headcount';

const TZ = 'Europe/Amsterdam';

/** Koppen for one guest: themselves + their (registered) plus-ones (#5). */
export function heads(g: Pick<Guest, 'plus'>): number {
  return headsOf(g);
}

/** Actual present check-in arrivals per guest (plus_ones_arrived), keyed by id. */
export type ArrivalsByGuest = ReadonlyMap<string, { arrived: number }>;

/**
 * ACTUAL present koppen for a checked-in guest from their arrival row (partial
 * check-in: a +3 with 1 companion present = 2 koppen). Falls back to the full
 * registered party when the arrivals map has no row yet (e.g. an optimistic flip
 * before the arrivals refetch, or a role that can't read check_ins).
 */
export function arrivedHeads(g: Guest, arrivals: ArrivalsByGuest): number {
  const a = arrivals.get(g.id);
  return 1 + (a ? a.arrived : g.plus || 0);
}

/** `Guest[]` + arrivals-map → the canonical selector's normalized row shape. */
function toHeadcountRows(guests: Guest[], arrivals: ArrivalsByGuest): HeadcountRow[] {
  return guests.map((g) => ({
    status: g.status,
    plus: g.plus,
    arrivedPlus: g.status === 'in' ? arrivals.get(g.id)?.arrived : undefined,
  }));
}

/** Koppen currently inside for a guest: their present arrivals, or 0 when the
 *  guest is not (yet) checked in. Drives the in-/uitcheck modals (S1.2). */
export function insideHeads(g: Guest, arrivals: ArrivalsByGuest): number {
  return g.status === 'in' ? arrivedHeads(g, arrivals) : 0;
}

/** The party math behind the cockpit's quantified in-/uitcheck modals (S1.2):
 *  full party koppen, how many are already inside, and how many are still
 *  onderweg. Pure so "X van Y binnen · nog Z" stays unit-tested. */
export interface PartyState {
  /** Full registered party (1 + plus_ones). */
  totalHeads: number;
  /** Koppen already inside (0 when onderweg). */
  insideHeads: number;
  /** Still to arrive (totalHeads − insideHeads). */
  remaining: number;
}

export function partyState(g: Guest, arrivals: ArrivalsByGuest): PartyState {
  const totalHeads = heads(g);
  const inside = insideHeads(g, arrivals);
  return { totalHeads, insideHeads: inside, remaining: totalHeads - inside };
}

/** Guests that count toward tonight (everything except refused). */
function onList(guests: Guest[]): Guest[] {
  return guests.filter((g) => g.status !== 'refused');
}

export interface CockpitTiles {
  /** Present headcount (checked-in koppen). */
  binnenH: number;
  /** On-list headcount (koppen, incl. +1's, excl. refused). */
  aangemeldH: number;
  /** Still to arrive (aangemeld − binnen). */
  onderwegH: number;
  /** Present / on-list as a 0..1 fraction (0 when nobody is on the list). */
  pct: number;
  /** Number of checked-in guest rows (not koppen) — for the segment count. */
  binnenN: number;
}

export function cockpitTiles(guests: Guest[], arrivals: ArrivalsByGuest = new Map()): CockpitTiles {
  const hc = computeHeadcounts(toHeadcountRows(guests, arrivals));
  return {
    binnenH: hc.insideHeads,
    aangemeldH: hc.onListHeads,
    onderwegH: hc.onTheWayHeads,
    pct: hc.attendancePct,
    binnenN: hc.insideRows,
  };
}

export interface CockpitCounts {
  all: number;
  wait: number;
  in: number;
  /** Refused guests — a separate bucket, never folded into `all` (they never
   *  occupied a slot; matches the canonical count rules: "Refused/Bounced
   *  telt in géén van de bovenstaande mee"). */
  refused: number;
}

/** Row counts (not koppen) for the Alle / Onderweg / Binnen / Refused segmented control. */
export function cockpitCounts(guests: Guest[]): CockpitCounts {
  const list = onList(guests);
  return {
    all: list.length,
    wait: list.filter((g) => g.status === 'wait').length,
    in: list.filter((g) => g.status === 'in').length,
    refused: guests.filter((g) => g.status === 'refused').length,
  };
}

export interface TierLiveRow {
  /** The REAL guest_tiers id this row groups (feedback 1/7: the role badge is a
   *  lossy taxonomy — two "vip"-ish tiers must stay two rows/chips). */
  tierId: string;
  /** Real tier name for the chip / panel. */
  tier: string;
  color: string;
  /** On-list headcount for this tier (excl. refused). */
  aangemeld: number;
  /** Present headcount for this tier. */
  binnen: number;
  /** Guest rows in this tier (drives "show only non-empty tiers"). */
  entries: number;
}

/**
 * Present-vs-on-list per tier, derived live from the guest list so the right-hand
 * panel updates the instant a check-in lands — no stats RPC needed. Grouped by the
 * real tier id (guests carry `tierId` since the 1/7 feedback), so every tier keeps
 * its own identity — the old role-badge grouping merged same-role tiers into one
 * row and dropped tiers from the filter.
 */
export function perTierLive(
  guests: Guest[],
  tiers: Tier[],
  arrivals: ArrivalsByGuest = new Map()
): TierLiveRow[] {
  const list = onList(guests);

  const rows: TierLiveRow[] = [];
  for (const t of tiers) {
    const gs = list.filter((g) => g.tierId === t.id);
    if (gs.length === 0) continue;
    const hc = computeHeadcounts(toHeadcountRows(gs, arrivals));
    rows.push({
      tierId: t.id,
      tier: t.name,
      color: t.color,
      aangemeld: hc.onListHeads,
      binnen: hc.insideHeads,
      entries: gs.length,
    });
  }
  return rows;
}

export type StatusFilter = 'all' | 'wait' | 'in' | 'refused';

/** The cockpit list after the status segment, tier chip (a real tier id, or
 *  'all') and search box. The 'refused' segment is the only one that shows
 *  refused guests — every other segment keeps them out (they never occupied
 *  a slot), matching the canonical count rules. */
export function filterCockpit(
  guests: Guest[],
  statF: StatusFilter,
  tierF: string,
  query: string
): Guest[] {
  const q = query.trim();
  return guests.filter((g) => {
    if (statF === 'refused') {
      if (g.status !== 'refused') return false;
    } else {
      if (g.status === 'refused') return false;
      if (statF === 'in' && g.status !== 'in') return false;
      if (statF === 'wait' && g.status !== 'wait') return false;
    }
    if (tierF !== 'all' && g.tierId !== tierF) return false;
    if (q && !fuzzyMatch(q, g.name)) return false;
    return true;
  });
}

/** First still-onderweg guest matching the query — drives "typ naam en druk Enter". */
export function matchFirstWaiting(guests: Guest[], query: string): Guest | null {
  const q = query.trim();
  if (!q) return null;
  return guests.find((g) => g.status === 'wait' && fuzzyMatch(q, g.name)) ?? null;
}

/** Optimistic in↔wait flip used by the check-in/void mutations (#25). Pure so the
 *  reconciliation is unit-tested without a QueryClient. A missing id is a no-op. */
export function flipGuestStatus(
  prev: Guest[] | undefined,
  guestId: string,
  to: GuestStatus,
  at?: string
): Guest[] | undefined {
  if (!prev) return prev;
  return prev.map((g) =>
    g.id === guestId ? { ...g, status: to, at: to === 'in' ? at ?? g.at : g.at } : g
  );
}

/** "HH:MM" in Europe/Amsterdam for a given instant (tabular live clock + bucket calc). */
export function amsterdamHM(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
}

/** "HH:MM:SS" in Europe/Amsterdam — the big live clock in the LIVE strip. */
export function amsterdamHMS(now: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(now);
}

/** Minutes since 06:00, so a club night that crosses midnight stays monotonic. */
function nightMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h < 6 ? h + 24 : h) * 60 + m;
}

/**
 * Index of the quarter-hour bucket that "now" falls in, for the chart's ring +
 * "nu HH:MM" badge. Buckets come from the stats RPC (already night-ordered).
 * Before the first bucket → 0; empty → -1.
 */
export function currentBucketIndex(buckets: { t: string }[], now: Date): number {
  if (buckets.length === 0) return -1;
  const nowMin = nightMinutes(amsterdamHM(now));
  let idx = 0;
  buckets.forEach((b, i) => {
    if (nightMinutes(b.t) <= nowMin) idx = i;
  });
  return idx;
}

/** A line in the cockpit's live activity feed (check-in/out or an approval note). */
export type FeedEntry =
  | { kind: 'in' | 'out'; t: string; name: string; plus: number }
  | { kind: 'msg'; t: string; msg: string; accent: boolean };

/** The human label for a feed entry (the timestamp is rendered separately). */
export function liveFeedLabel(e: FeedEntry): string {
  if (e.kind === 'msg') return e.msg;
  const tail = e.plus > 0 ? ` +${e.plus}` : '';
  return `${e.name}${tail} ${e.kind === 'in' ? 'checked in' : 'checked out'}`;
}

/** Whether a feed entry should render with the accent dot (positive/inbound). */
export function feedIsAccent(e: FeedEntry): boolean {
  return e.kind === 'msg' ? e.accent : e.kind === 'in';
}
