import { describe, expect, it } from 'vitest';
import type { Guest, Role, Tier } from '@/lib/po/types';
import {
  amsterdamHM,
  arrivedHeads,
  cockpitCounts,
  cockpitTiles,
  currentBucketIndex,
  feedIsAccent,
  filterCockpit,
  flipGuestStatus,
  heads,
  liveFeedLabel,
  matchFirstWaiting,
  perTierLive,
  type FeedEntry,
} from './cockpit';

function g(partial: Partial<Guest> & { id: string }): Guest {
  return {
    id: partial.id,
    name: partial.name ?? 'Naam',
    role: partial.role ?? 'Gast',
    pay: 'free',
    plus: partial.plus ?? 0,
    note: partial.note ?? '',
    flag: partial.flag ?? null,
    by: partial.by ?? '',
    addedAt: partial.addedAt ?? '1 jan',
    status: partial.status ?? 'wait',
    at: partial.at,
    inBy: partial.inBy,
  };
}

function tier(role: Role, color: string, short = role): Tier {
  return { id: `tier-${role}`, name: short, short, role, color, max: null, used: 0, doorPrice: 0, aliases: [] };
}

describe('heads', () => {
  it('counts the guest plus their plus-ones', () => {
    expect(heads({ plus: 0 })).toBe(1);
    expect(heads({ plus: 3 })).toBe(4);
  });
});

describe('cockpitTiles', () => {
  it('sums headcounts incl. +1s and excludes refused', () => {
    const guests = [
      g({ id: '1', status: 'in', plus: 2 }), // 3 koppen in
      g({ id: '2', status: 'in', plus: 0 }), // 1 kop in
      g({ id: '3', status: 'wait', plus: 1 }), // 2 koppen onderweg
      g({ id: '4', status: 'refused', plus: 5 }), // excluded
    ];
    const t = cockpitTiles(guests);
    expect(t.binnenH).toBe(4);
    expect(t.aangemeldH).toBe(6);
    expect(t.onderwegH).toBe(2);
    expect(t.binnenN).toBe(2);
    expect(Math.round(t.pct * 100)).toBe(67); // 4/6
  });

  it('is 0% when nobody is on the list (no divide-by-zero)', () => {
    expect(cockpitTiles([]).pct).toBe(0);
    expect(cockpitTiles([g({ id: '1', status: 'refused' })]).pct).toBe(0);
  });
});

describe('arrivals (partial check-in)', () => {
  const tiers = [tier('VIP', '#fff', 'VIP')];
  const guests = [
    g({ id: '1', role: 'VIP', status: 'in', plus: 3 }), // party of 4
    g({ id: '2', role: 'VIP', status: 'wait', plus: 0 }),
  ];
  it('arrivedHeads uses the arrival count, else falls back to the full party', () => {
    expect(arrivedHeads(guests[0], new Map([['1', { arrived: 1 }]]))).toBe(2); // self + 1 companion present
    expect(arrivedHeads(guests[0], new Map())).toBe(4); // no arrival row → full party
  });
  it('cockpitTiles counts actual arrivals for binnen, full party for aangemeld', () => {
    const arr = new Map([['1', { arrived: 1 }]]); // 2 of 4 present
    const t = cockpitTiles(guests, arr);
    expect(t.aangemeldH).toBe(5); // (1+3) + (1+0)
    expect(t.binnenH).toBe(2); // only the present koppen of guest 1
    expect(t.onderwegH).toBe(3); // 5 - 2
  });
  it('perTierLive reflects partial arrivals per tier', () => {
    const [vip] = perTierLive(guests, tiers, new Map([['1', { arrived: 1 }]]));
    expect(vip).toMatchObject({ binnen: 2, aangemeld: 5 });
  });
});

describe('cockpitCounts', () => {
  it('counts rows (not koppen) per segment, refused excluded', () => {
    const guests = [
      g({ id: '1', status: 'in', plus: 9 }),
      g({ id: '2', status: 'wait' }),
      g({ id: '3', status: 'wait' }),
      g({ id: '4', status: 'refused' }),
    ];
    expect(cockpitCounts(guests)).toEqual({ all: 3, wait: 2, in: 1 });
  });
});

describe('perTierLive', () => {
  it('groups by role with present/registered koppen, drops empty tiers', () => {
    const tiers = [tier('VIP', '#fff', 'VIP'), tier('Gast', '#aaa', 'Gast'), tier('Crew', '#0f0', 'Crew')];
    const guests = [
      g({ id: '1', role: 'VIP', status: 'in', plus: 1 }), // VIP 2 in / 2 aangemeld
      g({ id: '2', role: 'Gast', status: 'wait', plus: 0 }), // Gast 0 in / 1 aangemeld
      g({ id: '3', role: 'Gast', status: 'in', plus: 2 }), // Gast +3 in
      g({ id: '4', role: 'VIP', status: 'refused', plus: 4 }), // excluded
    ];
    const rows = perTierLive(guests, tiers);
    expect(rows.map((r) => r.role)).toEqual(['VIP', 'Gast']); // Crew has no guests → dropped
    const vip = rows.find((r) => r.role === 'VIP')!;
    expect(vip).toMatchObject({ binnen: 2, aangemeld: 2, color: '#fff', tier: 'VIP', entries: 1 });
    const gast = rows.find((r) => r.role === 'Gast')!;
    expect(gast).toMatchObject({ binnen: 3, aangemeld: 4, entries: 2 });
  });
});

describe('filterCockpit', () => {
  const guests = [
    g({ id: '1', name: 'Juri Braakman', role: 'VIP', status: 'wait' }),
    g({ id: '2', name: 'Sanne de Vries', role: 'Gast', status: 'in' }),
    g({ id: '3', name: 'Refused Rick', role: 'Gast', status: 'refused' }),
  ];
  it('always hides refused', () => {
    expect(filterCockpit(guests, 'all', 'all', '').map((x) => x.id)).toEqual(['1', '2']);
  });
  it('filters by status segment and tier', () => {
    expect(filterCockpit(guests, 'in', 'all', '').map((x) => x.id)).toEqual(['2']);
    expect(filterCockpit(guests, 'all', 'VIP', '').map((x) => x.id)).toEqual(['1']);
  });
  it('fuzzy-matches the search box (subsequence)', () => {
    expect(filterCockpit(guests, 'all', 'all', 'jrbr').map((x) => x.id)).toEqual(['1']);
  });
});

describe('matchFirstWaiting', () => {
  const guests = [
    g({ id: '1', name: 'Anna in', status: 'in' }),
    g({ id: '2', name: 'Bram wacht', status: 'wait' }),
    g({ id: '3', name: 'Bram tweede', status: 'wait' }),
  ];
  it('returns the first onderweg guest matching the query', () => {
    expect(matchFirstWaiting(guests, 'bram')?.id).toBe('2');
  });
  it('ignores already-in and refused guests', () => {
    expect(matchFirstWaiting(guests, 'anna')).toBeNull();
  });
  it('is null for an empty or non-matching query', () => {
    expect(matchFirstWaiting(guests, '')).toBeNull();
    expect(matchFirstWaiting(guests, 'zzz')).toBeNull();
  });
  it('is diacritic-insensitive', () => {
    const list = [g({ id: '9', name: 'Renée', status: 'wait' })];
    expect(matchFirstWaiting(list, 'renee')?.id).toBe('9');
  });
});

describe('flipGuestStatus', () => {
  const prev = [g({ id: '1', status: 'wait' }), g({ id: '2', status: 'in' })];
  it('flips wait→in and stamps the time', () => {
    const next = flipGuestStatus(prev, '1', 'in', '23:10')!;
    expect(next.find((x) => x.id === '1')).toMatchObject({ status: 'in', at: '23:10' });
    expect(next.find((x) => x.id === '2')).toMatchObject({ status: 'in' }); // untouched
  });
  it('flips in→wait', () => {
    expect(flipGuestStatus(prev, '2', 'wait')!.find((x) => x.id === '2')!.status).toBe('wait');
  });
  it('no-ops a missing id and passes through undefined', () => {
    expect(flipGuestStatus(prev, 'nope', 'in')).toEqual(prev);
    expect(flipGuestStatus(undefined, '1', 'in')).toBeUndefined();
  });
});

describe('amsterdamHM / currentBucketIndex', () => {
  it('formats an instant to HH:MM in Europe/Amsterdam (CEST)', () => {
    expect(amsterdamHM(new Date('2026-06-20T21:10:00Z'))).toBe('23:10');
  });
  it('finds the current bucket, wrapping past midnight', () => {
    const buckets = [{ t: '22:45' }, { t: '23:00' }, { t: '23:15' }, { t: '00:15' }];
    expect(currentBucketIndex(buckets, new Date('2026-06-20T21:10:00Z'))).toBe(1); // 23:10 → 23:00 bucket
    // 22:30 (before the first bucket) clamps to index 0.
    expect(currentBucketIndex(buckets, new Date('2026-06-20T20:30:00Z'))).toBe(0);
    expect(currentBucketIndex([], new Date('2026-06-20T21:10:00Z'))).toBe(-1);
  });
});

describe('liveFeedLabel / feedIsAccent', () => {
  it('labels a check-in with +N', () => {
    const e: FeedEntry = { kind: 'in', t: '23:10', name: 'Bram', plus: 2 };
    expect(liveFeedLabel(e)).toBe('Bram +2 ingecheckt');
    expect(feedIsAccent(e)).toBe(true);
  });
  it('labels a check-out without accent', () => {
    const e: FeedEntry = { kind: 'out', t: '23:11', name: 'Bram', plus: 0 };
    expect(liveFeedLabel(e)).toBe('Bram uitgecheckt');
    expect(feedIsAccent(e)).toBe(false);
  });
  it('passes a message entry through', () => {
    const e: FeedEntry = { kind: 'msg', t: '23:12', msg: 'Lisa goedgekeurd', accent: true };
    expect(liveFeedLabel(e)).toBe('Lisa goedgekeurd');
    expect(feedIsAccent(e)).toBe(true);
  });
});
