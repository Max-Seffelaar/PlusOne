import { describe, expect, it } from 'vitest';
import { eventKpis, toPerKwartier, toPerTier, toPerUser, venueKpis } from './po-adapter';
import type { EventSummary, QuarterBucket, TierStat, UserAddition, VenueSummary } from './data';

// Row factories — only the fields the adapter reads (all present so the shapes
// match the generated types). Buckets are UTC; formatClock renders Amsterdam
// (CEST in June = UTC+2), so 21:00Z → "23:00".
function summary(overrides: Partial<EventSummary> = {}): EventSummary {
  return {
    attendance_pct: 72,
    no_shows: 28,
    peak_bucket: '2026-06-20T21:00:00+00:00',
    peak_count: 38,
    present: 125,
    present_headcount: 140,
    refused: 6,
    registered: 100,
    registered_headcount: 180,
    ...overrides,
  };
}

function venueSummary(overrides: Partial<VenueSummary> = {}): VenueSummary {
  return {
    attendance_pct: 68,
    events: 4,
    no_shows: 50,
    present: 300,
    present_headcount: 320,
    refused: 12,
    registered: 415,
    registered_headcount: 470,
    ...overrides,
  };
}

describe('toPerKwartier', () => {
  it('maps bucket→clock label and checkins→n, preserving order', () => {
    const buckets: QuarterBucket[] = [
      { bucket: '2026-06-20T21:00:00+00:00', checkins: 4, headcount: 5 },
      { bucket: '2026-06-20T21:15:00+00:00', checkins: 9, headcount: 12 },
    ];
    expect(toPerKwartier(buckets)).toEqual([
      { t: '23:00', n: 4 },
      { t: '23:15', n: 9 },
    ]);
  });

  it('returns [] for no check-ins', () => {
    expect(toPerKwartier([])).toEqual([]);
  });
});

describe('toPerTier', () => {
  it('maps tier_name + headcounts to the po shape', () => {
    const tiers: TierStat[] = [
      {
        color: '#B5A6FF',
        present: 20,
        present_headcount: 22,
        registered: 28,
        registered_headcount: 30,
        tier_id: 't1',
        tier_name: 'VIP',
      },
    ];
    expect(toPerTier(tiers)).toEqual([{ tier: 'VIP', aangemeld: 30, binnen: 22 }]);
  });
});

describe('toPerUser', () => {
  it('maps full_name/added/present to who/added/in', () => {
    const users: UserAddition[] = [
      { added: 42, added_headcount: 50, full_name: 'Max Seffelaar', present: 33, user_id: 'u1' },
    ];
    expect(toPerUser(users)).toEqual([{ who: 'Max Seffelaar', added: 42, in: 33 }]);
  });
});

describe('eventKpis', () => {
  it('derives peak label, count, no-shows and rounded no-show pct', () => {
    expect(eventKpis(summary())).toEqual({ peak: '23:00', peakCount: 38, noShows: 28, noShowPct: 28 });
  });

  it('rounds no-show pct (1/3 → 33)', () => {
    expect(eventKpis(summary({ no_shows: 1, registered: 3 })).noShowPct).toBe(33);
  });

  it('returns 0 pct when nobody is registered (no divide-by-zero)', () => {
    expect(eventKpis(summary({ registered: 0, no_shows: 0 })).noShowPct).toBe(0);
  });

  it('has a null peak before the first check-in (empty peak_bucket)', () => {
    expect(eventKpis(summary({ peak_bucket: '', peak_count: 0 })).peak).toBeNull();
  });

  it('falls back to safe zeros for a null summary', () => {
    expect(eventKpis(null)).toEqual({ peak: null, peakCount: 0, noShows: 0, noShowPct: 0 });
  });
});

describe('venueKpis', () => {
  it('maps org-level summary fields', () => {
    expect(venueKpis(venueSummary())).toEqual({
      attendancePct: '68%',
      presentHeadcount: 320,
      refused: 12,
      events: 4,
    });
  });

  it('formats a fractional percentage to one decimal', () => {
    expect(venueKpis(venueSummary({ attendance_pct: 72.5 })).attendancePct).toBe('72.5%');
  });

  it('falls back to zeros / "0%" for a null summary', () => {
    expect(venueKpis(null)).toEqual({
      attendancePct: '0%',
      presentHeadcount: 0,
      refused: 0,
      events: 0,
    });
  });
});
