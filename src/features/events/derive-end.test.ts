import { describe, expect, it } from 'vitest';
import { deriveEnd } from './derive-end';

describe('deriveEnd', () => {
  it('rolls a late start over to the next morning (23:00 → 05:00 +1 day)', () => {
    expect(deriveEnd('2026-10-16', '23:00')).toEqual({ endDateStr: '2026-10-17', endTimeStr: '05:00' });
  });

  it('stays on the same day for an afternoon start (16:00 → 22:00)', () => {
    expect(deriveEnd('2026-10-16', '16:00')).toEqual({ endDateStr: '2026-10-16', endTimeStr: '22:00' });
  });

  it('lands exactly on midnight at 18:00', () => {
    expect(deriveEnd('2026-10-16', '18:00')).toEqual({ endDateStr: '2026-10-17', endTimeStr: '00:00' });
  });

  it('keeps the minutes', () => {
    expect(deriveEnd('2026-10-16', '22:45')).toEqual({ endDateStr: '2026-10-17', endTimeStr: '04:45' });
  });

  it('derives a DST-change night on the wall clock (25 Oct 2026, Europe/Amsterdam falls back)', () => {
    expect(deriveEnd('2026-10-24', '23:00')).toEqual({ endDateStr: '2026-10-25', endTimeStr: '05:00' });
    // and the spring-forward night (29 Mar 2026)
    expect(deriveEnd('2026-03-28', '23:30')).toEqual({ endDateStr: '2026-03-29', endTimeStr: '05:30' });
  });

  it('crosses a month and a year boundary', () => {
    expect(deriveEnd('2026-12-31', '23:00')).toEqual({ endDateStr: '2027-01-01', endTimeStr: '05:00' });
    expect(deriveEnd('2028-02-28', '23:00')).toEqual({ endDateStr: '2028-02-29', endTimeStr: '05:00' });
  });

  it('honours a custom number of hours', () => {
    expect(deriveEnd('2026-10-16', '23:00', 2)).toEqual({ endDateStr: '2026-10-17', endTimeStr: '01:00' });
    expect(deriveEnd('2026-10-16', '10:00', 0)).toEqual({ endDateStr: '2026-10-16', endTimeStr: '10:00' });
  });

  it('returns empty strings for empty or unreadable input', () => {
    expect(deriveEnd('', '')).toEqual({ endDateStr: '', endTimeStr: '' });
    expect(deriveEnd('2026-10-16', '')).toEqual({ endDateStr: '', endTimeStr: '' });
    expect(deriveEnd('', '23:00')).toEqual({ endDateStr: '', endTimeStr: '' });
    expect(deriveEnd('16-10-2026', '23:00')).toEqual({ endDateStr: '', endTimeStr: '' });
    expect(deriveEnd('2026-02-31', '23:00')).toEqual({ endDateStr: '', endTimeStr: '' });
    expect(deriveEnd('2026-10-16', '25:00')).toEqual({ endDateStr: '', endTimeStr: '' });
  });
});
