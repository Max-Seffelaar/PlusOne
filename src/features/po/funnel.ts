/**
 * Promotion funnel math: views → requested → approved → checked in.
 *
 * Every step after views counts PEOPLE (1 + plus-ones), never request rows —
 * dividing a headcount by a row count is what once read "31 requests → 46
 * approved (148%)". Approval can only keep or trim a request's plus-ones, so
 * for normal data requestedHeads ≥ approvedHeads ≥ checkedInHeads and each
 * step-to-step percentage stays ≤ 100%. Each percentage is the ratio of the two
 * tiles it sits between, so a reader can check it from the numbers on screen.
 */
import type { PoFunnel } from './queries';

export const EMPTY_FUNNEL: PoFunnel = { views: 0, requests: 0, requestedHeads: 0, approvedHeads: 0, checkedInHeads: 0 };

/** Element-wise sum (e.g. every link on one event → the overview tiles). */
export function sumFunnels(rows: readonly PoFunnel[]): PoFunnel {
  return rows.reduce<PoFunnel>(
    (a, f) => ({
      views: a.views + f.views,
      requests: a.requests + f.requests,
      requestedHeads: a.requestedHeads + f.requestedHeads,
      approvedHeads: a.approvedHeads + f.approvedHeads,
      checkedInHeads: a.checkedInHeads + f.checkedInHeads,
    }),
    EMPTY_FUNNEL,
  );
}

/** Whole-number percentage of `part` in `whole`; 0 when there is no whole. */
export function funnelPct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export interface FunnelConversion {
  /** Requested people per landing view. */
  requested: number;
  /** Approved people out of requested people. */
  approved: number;
  /** Checked-in people out of approved people. */
  showedUp: number;
}

export function funnelConversion(f: PoFunnel): FunnelConversion {
  return {
    requested: funnelPct(f.requestedHeads, f.views),
    approved: funnelPct(f.approvedHeads, f.requestedHeads),
    showedUp: funnelPct(f.checkedInHeads, f.approvedHeads),
  };
}

/**
 * Requested headcount from an RPC row. `requested_heads` arrived with migration
 * 20261013120000; the app can deploy before the schema push, so a row without
 * it falls back to the request count (1 head per request — the floor) instead
 * of rendering NaN.
 */
export function requestedHeadsOf(row: { requests: number; requested_heads?: number | null }): number {
  return row.requested_heads ?? row.requests;
}
