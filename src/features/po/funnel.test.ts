import { describe, expect, it } from 'vitest';
import { EMPTY_FUNNEL, funnelConversion, funnelPct, requestedHeadsOf, sumFunnels } from './funnel';
import type { PoFunnel } from './queries';

const f = (p: Partial<PoFunnel>): PoFunnel => ({ ...EMPTY_FUNNEL, ...p });

describe('funnelPct', () => {
  it('rounds to a whole percentage', () => {
    expect(funnelPct(1, 3)).toBe(33);
    expect(funnelPct(2, 3)).toBe(67);
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

  it('each percentage is the ratio of the two adjacent tiles', () => {
    expect(funnelConversion(bugCase)).toEqual({
      requested: funnelPct(52, 400),
      approved: funnelPct(46, 52),
      showedUp: funnelPct(40, 46),
    });
  });

  it('never exceeds 100% for normal data (approval only keeps or trims plus-ones)', () => {
    // Every request fully approved with its plus-ones, everyone shows up.
    const full = f({ views: 10, requests: 3, requestedHeads: 9, approvedHeads: 9, checkedInHeads: 9 });
    expect(funnelConversion(full)).toEqual({ requested: 90, approved: 100, showedUp: 100 });

    // A sweep of plausible shapes: requested ≥ approved ≥ checked in, and
    // views ≥ requested people.
    for (let requests = 1; requests <= 12; requests++) {
      for (let plus = 0; plus <= 3; plus++) {
        const requestedHeads = requests * (1 + plus);
        for (let approvedHeads = 0; approvedHeads <= requestedHeads; approvedHeads++) {
          const c = funnelConversion(
            f({ views: requestedHeads * 2, requests, requestedHeads, approvedHeads, checkedInHeads: Math.floor(approvedHeads / 2) }),
          );
          expect(c.requested).toBeLessThanOrEqual(100);
          expect(c.approved).toBeLessThanOrEqual(100);
          expect(c.showedUp).toBeLessThanOrEqual(100);
        }
      }
    }
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
});

describe('requestedHeadsOf', () => {
  it('reads requested_heads from the RPC row', () => {
    expect(requestedHeadsOf({ requests: 3, requested_heads: 7 })).toBe(7);
  });

  it('falls back to the request count when the column is absent (app ahead of schema push)', () => {
    expect(requestedHeadsOf({ requests: 3 })).toBe(3);
    expect(requestedHeadsOf({ requests: 3, requested_heads: null })).toBe(3);
  });
});
