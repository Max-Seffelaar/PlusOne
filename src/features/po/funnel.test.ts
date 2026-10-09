import { describe, expect, it } from 'vitest';
import { EMPTY_FUNNEL, funnelConversion, funnelPct, requestedDisplay, requestedHeadsOf, sumFunnels } from './funnel';
import type { PoFunnel } from './queries';

const f = (p: Partial<PoFunnel>): PoFunnel => ({ ...EMPTY_FUNNEL, ...p });

describe('funnelPct', () => {
  it('rounds to a whole percentage', () => {
    expect(funnelPct(1, 3)).toBe(33);
    expect(funnelPct(2, 3)).toBe(67);
  });

  it('caps at 100 — a funnel step never converts more than everything', () => {
    expect(funnelPct(5, 2)).toBe(100);
  });

  it('is 0 when there is nothing to divide by (no NaN/Infinity)', () => {
    expect(funnelPct(0, 0)).toBe(0);
    expect(funnelPct(5, 0)).toBe(0);
  });
});

describe('funnelConversion — one unit (people) after views', () => {
  // The reported bug: 31 request rows carrying 46 approved people read as
  // "148% approved" because heads were divided by rows.
  const bugCase = f({ views: 400, requests: 31, requestedHeads: 52, approvedHeads: 46, checkedInHeads: 40 });

  it('divides approved people by REQUESTED people, not by request rows', () => {
    const c = funnelConversion(bugCase);
    expect(c.approved).toBe(88); // 46 / 52 — was 148 (46 / 31)
    expect(c.approved).not.toBe(funnelPct(bugCase.approvedHeads, bugCase.requests));
  });

  it('compares like with like: request rows per view, then people over people', () => {
    expect(funnelConversion(bugCase)).toEqual({
      requested: funnelPct(31, 400), // submissions per landing view
      approved: funnelPct(46, 52),
      showedUp: funnelPct(40, 46),
    });
  });

  it('a small link with big parties does not read >100% requested (rows, not heads, per view)', () => {
    // 10 views, 4 requests of +3 = 16 people: heads/views would be 160%.
    const c = funnelConversion(f({ views: 10, requests: 4, requestedHeads: 16, approvedHeads: 16 }));
    expect(c.requested).toBe(40);
  });

  it('caps "approved" at 100% when a guest\'s plus-ones were raised after approval', () => {
    // Approved +1 (2 requested), then edited to +4 → 5 approved people.
    const c = funnelConversion(f({ views: 5, requests: 1, requestedHeads: 2, approvedHeads: 5 }));
    expect(c.approved).toBe(100);
  });

  it('never exceeds 100%, whatever the shape of the data', () => {
    for (const views of [0, 1, 3, 10, 400]) {
      for (let requests = 0; requests <= 6; requests++) {
        for (let plus = 0; plus <= 4; plus++) {
          const requestedHeads = requests * (1 + plus);
          for (const approvedHeads of [0, requestedHeads, requestedHeads + 3]) {
            for (const checkedInHeads of [0, approvedHeads, approvedHeads + 2]) {
              const c = funnelConversion(f({ views, requests, requestedHeads, approvedHeads, checkedInHeads }));
              for (const v of [c.requested, c.approved, c.showedUp]) {
                expect(v).not.toBeNull();
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(100);
              }
            }
          }
        }
      }
    }
  });

  it('leaves "approved" unknown (null) instead of dividing people by request rows when requested people is missing', () => {
    const c = funnelConversion(f({ views: 400, requests: 31, requestedHeads: null, approvedHeads: 46 }));
    expect(c.approved).toBeNull();
    expect(c.requested).toBe(8);
  });

  it('reads 0% (not NaN) on an empty funnel', () => {
    expect(funnelConversion(EMPTY_FUNNEL)).toEqual({ requested: 0, approved: 0, showedUp: 0 });
  });
});

describe('sumFunnels', () => {
  it('sums every field element-wise across links', () => {
    expect(
      sumFunnels([
        f({ views: 10, requests: 2, requestedHeads: 5, approvedHeads: 4, checkedInHeads: 3 }),
        f({ views: 5, requests: 1, requestedHeads: 1, approvedHeads: 1, checkedInHeads: 0 }),
      ]),
    ).toEqual({ views: 15, requests: 3, requestedHeads: 6, approvedHeads: 5, checkedInHeads: 3 });
  });

  it('is the empty funnel for no links', () => {
    expect(sumFunnels([])).toEqual(EMPTY_FUNNEL);
  });

  it('an unknown requested headcount on any link makes the total unknown', () => {
    expect(sumFunnels([f({ requestedHeads: 3 }), f({ requestedHeads: null })]).requestedHeads).toBeNull();
  });
});

describe('requestedHeadsOf / requestedDisplay', () => {
  it('reads requested_heads from the RPC row', () => {
    expect(requestedHeadsOf({ requested_heads: 7 })).toBe(7);
  });

  it('is null — never the request row count — when the column is absent (app ahead of schema push)', () => {
    expect(requestedHeadsOf({})).toBeNull();
    expect(requestedHeadsOf({ requested_heads: null })).toBeNull();
  });

  it('the Requested tile shows people, or the request count as a floor while unknown', () => {
    expect(requestedDisplay({ requests: 3, requestedHeads: 7 })).toBe(7);
    expect(requestedDisplay({ requests: 3, requestedHeads: null })).toBe(3);
  });
});
