/**
 * THE canonical headcount selector (M4, ux-ia-audit-claude-code.md §5.2 /
 * gastenlijst-app-spec.md decision #44). Door, cockpit and every other
 * client-rendered surface funnel their guest rows through `computeHeadcounts`
 * instead of re-deriving on-list/inside/on-the-way themselves — that
 * duplication (door's `buildDoorView` and the cockpit's `cockpitTiles` each
 * had their own reducer) is what let the two drift apart (K-10).
 *
 * Rules (heads = koppen, incl. +1's):
 *  - On the list  = Σ(1 + plus_ones) over guests with status ≠ removed (never
 *    passed in — every caller's query already excludes it) and ≠ refused.
 *  - Inside       = Σ arrived heads for on-list guests that are checked in; a
 *    partial check-in only counts the companions that actually arrived.
 *  - On the way   = On the list − Inside.
 *  - Refused      = tracked separately; contributes to none of the above.
 *  - Attendance   = Inside ÷ On the list (0 when the list is empty).
 */

export interface HeadcountRow {
  /** 'refused' guests are excluded from the on-list pool everywhere (#44). */
  status: 'in' | 'wait' | 'refused';
  /** Registered plus-ones (party size − 1). */
  plus: number;
  /** Companions actually present, meaningful only when `status` is 'in'.
   *  Omitted → falls back to the full registered party (an optimistic flip
   *  before the arrivals refetch lands, or a role that can't read check_ins). */
  arrivedPlus?: number;
}

/** Koppen for one guest: themselves + their registered plus-ones. */
export function heads(row: Pick<HeadcountRow, 'plus'>): number {
  return 1 + (row.plus || 0);
}

/** Koppen actually present for a checked-in guest (partial-check-in aware). */
export function arrivedHeadsOf(row: Pick<HeadcountRow, 'plus' | 'arrivedPlus'>): number {
  return 1 + (row.arrivedPlus ?? row.plus ?? 0);
}

export interface Headcounts {
  onListHeads: number;
  onListRows: number;
  insideHeads: number;
  insideRows: number;
  onTheWayHeads: number;
  onTheWayRows: number;
  refusedHeads: number;
  refusedRows: number;
  /** Inside ÷ on-list, as a 0..1 fraction (0 when the list is empty). */
  attendancePct: number;
}

export function computeHeadcounts(rows: readonly HeadcountRow[]): Headcounts {
  const onList = rows.filter((r) => r.status !== 'refused');
  const inside = onList.filter((r) => r.status === 'in');
  const refused = rows.filter((r) => r.status === 'refused');

  const onListHeads = onList.reduce((n, r) => n + heads(r), 0);
  const insideHeads = inside.reduce((n, r) => n + arrivedHeadsOf(r), 0);
  const refusedHeads = refused.reduce((n, r) => n + heads(r), 0);

  return {
    onListHeads,
    onListRows: onList.length,
    insideHeads,
    insideRows: inside.length,
    onTheWayHeads: onListHeads - insideHeads,
    onTheWayRows: onList.length - inside.length,
    refusedHeads,
    refusedRows: refused.length,
    attendancePct: onListHeads > 0 ? insideHeads / onListHeads : 0,
  };
}
