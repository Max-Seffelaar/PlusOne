import { describe, expect, it } from 'vitest';
import { quotaShortfall } from './shortfall';

describe('quotaShortfall (z8uq9m5kux, Max 2026-10-14)', () => {
  it("Max's numbers: 7 left, a +4 guest (5 spots) fits, so no request", () => {
    expect(quotaShortfall(5, 7)).toBeNull();
  });

  it('7 left, a +6 guest (7 spots) fits exactly', () => {
    expect(quotaShortfall(7, 7)).toBeNull();
  });

  it('3 left, a +4 guest needs 2 more spots', () => {
    expect(quotaShortfall(5, 3)).toBe(2);
  });

  it('0 left, a +4 guest needs all 5', () => {
    expect(quotaShortfall(5, 0)).toBe(5);
  });

  it('no limit (exempt or not loaded): never a request', () => {
    expect(quotaShortfall(51, null)).toBeNull();
  });
});
