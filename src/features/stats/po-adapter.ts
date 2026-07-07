import { formatClock, formatPct } from './format';
import type { EventSummary, QuarterBucket, TierStat, UserAddition, VenueSummary } from './data';

// Maps the Postgres analytics rows onto the po prototype's mock-data shapes so the
// existing Statistieken visuals (desktop /dashboard + mobile /app) render live
// numbers without changing their markup. Pure — no I/O — so it's unit-tested
// directly (po-adapter.test.ts). The bar charts keep the prototype's "tallest bar
// = peak" accent (it coincides with the summary's peak bucket), so no raw-ISO
// bucket comparison is needed here.

export interface PerKwartier {
  t: string;
  n: number;
}
export interface PerTier {
  tier: string;
  aangemeld: number;
  binnen: number;
}
export interface PerUser {
  who: string;
  /** Heads added (gross, INCLUDING later-removed): the unit is heads (1 + plus-ones). */
  added: number;
  /** Heads later removed (a subset of `added`). */
  removed: number;
  /** Heads that actually arrived (checked in). */
  in: number;
  /** Free/paid split of the added heads (paid = added − free). Informational —
   *  paid tiers are display-only (#T3). */
  addedFree: number;
  addedPaid: number;
  /** Free/paid split of the checked-in heads. */
  inFree: number;
  inPaid: number;
}

/** Check-ins per 15-min bucket → { t: "23:30", n: 38 } (bucket order preserved). */
export function toPerKwartier(perQuarter: QuarterBucket[]): PerKwartier[] {
  return perQuarter.map((b) => ({ t: formatClock(b.bucket), n: b.checkins }));
}

/** Tier rows → { tier, aangemeld, binnen } using headcounts (1 + plus-ones). */
export function toPerTier(tiers: TierStat[]): PerTier[] {
  return tiers.map((t) => ({
    tier: t.tier_name,
    aangemeld: t.registered_headcount,
    binnen: t.present_headcount,
  }));
}

/**
 * Additions per member → heads-based per-user stats (T9). The unit is HEADS
 * (1 + plus-ones) throughout — `added` is the gross count including later-removed
 * guests, `removed` the subset now off the list, `in` the heads that arrived.
 * Paid is derived from free (paid = total − free) so a NULL never leaks negative.
 */
export function toPerUser(users: UserAddition[]): PerUser[] {
  return users.map((u) => ({
    who: u.full_name,
    added: u.added_headcount,
    removed: u.removed_headcount,
    in: u.present_headcount,
    addedFree: u.added_free_headcount,
    addedPaid: u.added_headcount - u.added_free_headcount,
    inFree: u.present_free_headcount,
    inPaid: u.present_headcount - u.present_free_headcount,
  }));
}

export interface EventKpis {
  /** Peak 15-min window as "23:00", or null when there are no check-ins yet. */
  peak: string | null;
  peakCount: number;
  noShows: number;
  /** No-shows as a whole percentage of registered guests; 0 when none registered. */
  noShowPct: number;
}

export function eventKpis(summary: EventSummary | null): EventKpis {
  if (!summary) return { peak: null, peakCount: 0, noShows: 0, noShowPct: 0 };
  const noShowPct =
    summary.registered > 0 ? Math.round((summary.no_shows / summary.registered) * 100) : 0;
  return {
    // peak_bucket is typed string but is empty/absent before the first check-in.
    peak: summary.peak_bucket ? formatClock(summary.peak_bucket) : null,
    peakCount: summary.peak_count,
    noShows: summary.no_shows,
    noShowPct,
  };
}

export interface VenueKpis {
  attendancePct: string;
  presentHeadcount: number;
  refused: number;
  events: number;
}

/** Org-level KPIs (all events in range) — meaningful without selecting an event. */
export function venueKpis(summary: VenueSummary | null): VenueKpis {
  return {
    attendancePct: formatPct(summary?.attendance_pct ?? 0),
    presentHeadcount: summary?.present_headcount ?? 0,
    refused: summary?.refused ?? 0,
    events: summary?.events ?? 0,
  };
}
