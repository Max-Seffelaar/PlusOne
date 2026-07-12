import { describe, expect, it } from 'vitest';
import { arrivedHeadsOf, computeHeadcounts, heads, type HeadcountRow } from './headcount';

describe('heads', () => {
  it('counts the guest plus their plus-ones', () => {
    expect(heads({ plus: 0 })).toBe(1);
    expect(heads({ plus: 3 })).toBe(4);
  });
});

describe('arrivedHeadsOf', () => {
  it('uses arrivedPlus when present', () => {
    expect(arrivedHeadsOf({ plus: 3, arrivedPlus: 1 })).toBe(2);
  });
  it('falls back to the full registered party when arrivedPlus is omitted', () => {
    expect(arrivedHeadsOf({ plus: 3 })).toBe(4);
  });
});

describe('computeHeadcounts — canonical M4 rules (spec #44)', () => {
  it('on-list excludes refused (never removed — callers already filter it)', () => {
    const rows: HeadcountRow[] = [
      { status: 'wait', plus: 0 },
      { status: 'in', plus: 0 },
      { status: 'refused', plus: 5 }, // would add 6 heads if wrongly included
    ];
    const hc = computeHeadcounts(rows);
    expect(hc.onListHeads).toBe(2);
    expect(hc.onListRows).toBe(2);
  });

  it('inside counts only arrived heads on a partial check-in', () => {
    const rows: HeadcountRow[] = [{ status: 'in', plus: 3, arrivedPlus: 1 }]; // party of 4, 2 present
    const hc = computeHeadcounts(rows);
    expect(hc.insideHeads).toBe(2);
    expect(hc.insideRows).toBe(1);
  });

  it('inside falls back to the full party when arrivedPlus is missing (optimistic flip)', () => {
    const hc = computeHeadcounts([{ status: 'in', plus: 2 }]);
    expect(hc.insideHeads).toBe(3);
  });

  it('on the way = on the list − inside (heads and rows)', () => {
    const rows: HeadcountRow[] = [
      { status: 'in', plus: 2, arrivedPlus: 1 }, // 3 on list, 2 inside
      { status: 'wait', plus: 1 }, // 2 on list, 0 inside
    ];
    const hc = computeHeadcounts(rows);
    expect(hc.onListHeads).toBe(5);
    expect(hc.insideHeads).toBe(2);
    expect(hc.onTheWayHeads).toBe(3);
    expect(hc.onTheWayRows).toBe(1);
  });

  it('refused is tracked separately and contributes to nothing else', () => {
    const rows: HeadcountRow[] = [
      { status: 'wait', plus: 0 },
      { status: 'refused', plus: 2 },
      { status: 'refused', plus: 0 },
    ];
    const hc = computeHeadcounts(rows);
    expect(hc.refusedRows).toBe(2);
    expect(hc.refusedHeads).toBe(4);
    expect(hc.onListRows).toBe(1);
    expect(hc.onTheWayHeads).toBe(1);
  });

  it('attendance = inside / on-list, 0 when the list is empty (no divide-by-zero)', () => {
    expect(computeHeadcounts([]).attendancePct).toBe(0);
    expect(computeHeadcounts([{ status: 'refused', plus: 0 }]).attendancePct).toBe(0);
    const hc = computeHeadcounts([
      { status: 'in', plus: 1 }, // 2 heads inside
      { status: 'wait', plus: 1 }, // 2 heads on the way
    ]);
    expect(hc.attendancePct).toBe(0.5);
  });

  it('K-10 repro: a same-moment read must agree whether the row set comes in one array or split refused/active', () => {
    // Door builds `guests` (active) and `refused` separately, then only passes
    // `guests` through; cockpit passes the full unsplit array. Both must land on
    // the same numbers for the same underlying data.
    const all: HeadcountRow[] = [
      { status: 'in', plus: 1, arrivedPlus: 1 },
      { status: 'wait', plus: 0 },
      { status: 'wait', plus: 2 },
      { status: 'refused', plus: 0 },
    ];
    const active = all.filter((r) => r.status !== 'refused');
    const { onListHeads, onListRows, insideHeads, insideRows, onTheWayHeads, onTheWayRows, attendancePct } =
      computeHeadcounts(all);
    expect(computeHeadcounts(active)).toMatchObject({
      onListHeads,
      onListRows,
      insideHeads,
      insideRows,
      onTheWayHeads,
      onTheWayRows,
      attendancePct,
    });
  });
});
