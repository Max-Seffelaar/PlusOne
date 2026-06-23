import { describe, expect, it } from 'vitest';
import { resolveAllowUncheck } from './allow-uncheck';

describe('resolveAllowUncheck', () => {
  it('uses the per-event override when set (both directions)', () => {
    expect(resolveAllowUncheck(true, false)).toBe(true);
    expect(resolveAllowUncheck(false, true)).toBe(false);
  });

  it('falls back to the venue default when there is no override', () => {
    expect(resolveAllowUncheck(null, true)).toBe(true);
    expect(resolveAllowUncheck(null, false)).toBe(false);
    expect(resolveAllowUncheck(undefined, false)).toBe(false);
  });

  it('defaults to true (opt-out) when neither is set', () => {
    expect(resolveAllowUncheck(null, null)).toBe(true);
    expect(resolveAllowUncheck(undefined, undefined)).toBe(true);
  });
});
