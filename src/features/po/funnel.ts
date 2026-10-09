/**
 * Promotion funnel math: views → requested → approved → checked in.
 *
 * The tiles after views count PEOPLE (1 + plus-ones), never request rows —
 * dividing a headcount by a row count is what once read "31 requests → 46
 * approved (148%)". Each percentage compares like with like:
 *   requested = request ROWS per view (one submission per landing visit; a
 *               headcount would read "160%" on a small link with big parties)
 *   approved  = approved people / requested people
 *   showed up = checked-in people / approved people
 * and is capped at 100%: approval only keeps or trims plus-ones, but an admin
 * can still raise a guest's plus-ones after approval, and a funnel step never
 * converts more than everything (the tiles keep the real counts).
 */
import type { PoFunnel } from './queries';

export const EMPTY_FUNNEL: PoFunnel = { views: 0, requests: 0, requestedHeads: 0, approvedHeads: 0, checkedInHeads: 0 };

/** Element-wise sum (e.g. every link on one event → the overview tiles). An
 *  unknown requestedHeads anywhere makes the total unknown. */
export function sumFunnels(rows: readonly PoFunnel[]): PoFunnel {
  return rows.reduce<PoFunnel>(
    (a, f) => ({
      views: a.views + f.views,
      requests: a.requests + f.requests,
      requestedHeads: a.requestedHeads == null || f.requestedHeads == null ? null : a.requestedHeads + f.requestedHeads,
      approvedHeads: a.approvedHeads + f.approvedHeads,
      checkedInHeads: a.checkedInHeads + f.checkedInHeads,
    }),
    EMPTY_FUNNEL,
  );
}

/** Whole-number percentage of `part` in `whole`, capped at 100; 0 when there is
 *  no whole. */
export function funnelPct(part: number, whole: number): number {
  return whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0;
}

export interface FunnelConversion {
  /** Request submissions per landing view. */
  requested: number;
  /** Approved people out of requested people; null while requested people is
   *  unknown (app deployed ahead of the schema push). */
  approved: number | null;
  /** Checked-in people out of approved people. */
  showedUp: number;
}

export function funnelConversion(f: PoFunnel): FunnelConversion {
  return {
    requested: funnelPct(f.requests, f.views),
    approved: f.requestedHeads == null ? null : funnelPct(f.approvedHeads, f.requestedHeads),
    showedUp: funnelPct(f.checkedInHeads, f.approvedHeads),
  };
}

/**
 * Requested headcount from an RPC row. `requested_heads` arrived with migration
 * 20261013120000; the app can deploy before the schema push, and then this is
 * null — never the request ROW count, which would quietly bring back the
 * heads-over-rows ratio this module exists to prevent.
 */
export function requestedHeadsOf(row: { requested_heads?: number | null }): number | null {
  return row.requested_heads ?? null;
}

/** What a "Requested" tile shows: people when known, else the request count
 *  (a floor — every request is at least one person). */
export function requestedDisplay(f: Pick<PoFunnel, 'requests' | 'requestedHeads'>): number {
  return f.requestedHeads ?? f.requests;
}
