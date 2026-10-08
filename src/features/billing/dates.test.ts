import { describe, expect, it } from 'vitest';
import { endOfDayInAmsterdam } from './dates';

describe('endOfDayInAmsterdam', () => {
  it('winter (UTC+1): 23:59:59 local = 22:59:59Z', () => {
    expect(endOfDayInAmsterdam('2026-12-31')?.toISOString()).toBe('2026-12-31T22:59:59.000Z');
  });

  it('summer (UTC+2): 23:59:59 local = 21:59:59Z', () => {
    expect(endOfDayInAmsterdam('2026-07-15')?.toISOString()).toBe('2026-07-15T21:59:59.000Z');
  });

  it('rejects a non-day', () => {
    expect(endOfDayInAmsterdam('2026-02-30')).toBeNull();
    expect(endOfDayInAmsterdam('31-10-2026')).toBeNull();
    expect(endOfDayInAmsterdam('')).toBeNull();
  });
});
