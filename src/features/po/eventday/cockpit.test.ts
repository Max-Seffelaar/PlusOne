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
  insideHeads,
  liveFeedLabel,
  matchFirstWaiting,
  partyState,
  perTierLive,
  type FeedEntry,
} from './cockpit';

function g(partial: Partial<Guest> & { id: string }): Guest {
  return {
    id: partial.id,
    name: partial.name ?? 'Naam',
    role: partial.role ?? 'Guest',
    // Live guests carry the real tier id; default it from the role so the
    // fixtures line up with tier()'s `tier-${role}` ids.
    tierId: partial.tierId ?? `tier-${partial.role ?? 'Guest'}`,
    tierName: partial.tierName,
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
  return { id: `tier-${role}`, name: short, short, role, color, max: null, used: 0, doorPrice: 0, vatPercent: null, aliases: [] };
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

describe('insideHeads / partyState (S1.2 in-/uitcheck modals)', () => {
  it('insideHeads is 0 when onderweg, the arrived koppen when in', () => {
    expect(insideHeads(g({ id: '1', status: 'wait', plus: 2 }), new Map())).toBe(0);
    // in, 1 companion present → 2 koppen inside
    expect(insideHeads(g({ id: '1', status: 'in', plus: 2 }), new Map([['1', { arrived: 1 }]]))).toBe(2);
    // in, no arrival row → falls back to the full party (1 + 2 = 3)
    expect(insideHeads(g({ id: '1', status: 'in', plus: 2 }), new Map())).toBe(3);
  });

  it('partyState reports total / inside / remaining koppen', () => {
    // +3 party, onderweg: 0 inside, 4 still to come
    expect(partyState(g({ id: '1', status: 'wait', plus: 3 }), new Map())).toEqual({
      totalHeads: 4,
      insideHeads: 0,
      remaining: 4,
    });
    // +3 party, 1 of them inside (self only) → 1 inside, 3 remaining ("1 van 4 · nog 3")
    expect(partyState(g({ id: '1', status: 'in', plus: 3 }), new Map([['1', { arrived: 0 }]]))).toEqual({
      totalHeads: 4,
      insideHeads: 1,
      remaining: 3,
    });
    // fully inside: nothing remaining
    expect(partyState(g({ id: '1', status: 'in', plus: 3 }), new Map([['1', { arrived: 3 }]]))).toEqual({
      totalHeads: 4,
      insideHeads: 4,
      remaining: 0,
    });
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
  it('groups by tier id with present/registered koppen, drops empty tiers', () => {
    const tiers = [tier('VIP', '#fff', 'VIP'), tier('Guest', '#aaa', 'Guest'), tier('Crew', '#0f0', 'Crew')];
    const guests = [
      g({ id: '1', role: 'VIP', status: 'in', plus: 1 }), // VIP 2 in / 2 aangemeld
      g({ id: '2', role: 'Guest', status: 'wait', plus: 0 }), // Guest 0 in / 1 registered
      g({ id: '3', role: 'Guest', status: 'in', plus: 2 }), // Guest +3 in
      g({ id: '4', role: 'VIP', status: 'refused', plus: 4 }), // excluded
    ];
    const rows = perTierLive(guests, tiers);
    expect(rows.map((r) => r.tierId)).toEqual(['tier-VIP', 'tier-Guest']); // Crew has no guests → dropped
    const vip = rows.find((r) => r.tierId === 'tier-VIP')!;
    expect(vip).toMatchObject({ binnen: 2, aangemeld: 2, color: '#fff', tier: 'VIP', entries: 1 });
    const gast = rows.find((r) => r.tierId === 'tier-Guest')!;
    expect(gast).toMatchObject({ binnen: 3, aangemeld: 4, entries: 2 });
  });

  it('keeps two same-role tiers as two distinct rows with their real names (feedback 1/7)', () => {
    // Both collapse to the VIP role — the old role-keyed grouping merged them
    // into one row (last label won) and the "VIP" chip vanished from the filter.
    const tiers: Tier[] = [
      { ...tier('VIP', '#fff'), id: 't-vip', name: 'VIP', short: 'VIP' },
      { ...tier('VIP', '#f0f'), id: 't-vip-fles', name: 'VIP + fles op tafel', short: 'VIP + fles op tafel' },
    ];
    const guests = [
      g({ id: '1', tierId: 't-vip', status: 'in', plus: 0 }),
      g({ id: '2', tierId: 't-vip-fles', status: 'wait', plus: 1 }),
    ];
    const rows = perTierLive(guests, tiers);
    expect(rows.map((r) => r.tier)).toEqual(['VIP', 'VIP + fles op tafel']);
    expect(rows.map((r) => r.tierId)).toEqual(['t-vip', 't-vip-fles']);
    expect(rows[0]).toMatchObject({ binnen: 1, aangemeld: 1 });
    expect(rows[1]).toMatchObject({ binnen: 0, aangemeld: 2 });
  });
});

describe('filterCockpit', () => {
  const guests = [
    g({ id: '1', name: 'Juri Braakman', role: 'VIP', status: 'wait' }),
    g({ id: '2', name: 'Sanne de Vries', role: 'Guest', status: 'in' }),
    g({ id: '3', name: 'Refused Rick', role: 'Guest', status: 'refused' }),
  ];
  it('always hides refused', () => {
    expect(filterCockpit(guests, 'all', 'all', '').map((x) => x.id)).toEqual(['1', '2']);
  });
  it('filters by status segment and tier (real tier id)', () => {
    expect(filterCockpit(guests, 'in', 'all', '').map((x) => x.id)).toEqual(['2']);
    expect(filterCockpit(guests, 'all', 'tier-VIP', '').map((x) => x.id)).toEqual(['1']);
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
    expect(liveFeedLabel(e)).toBe('Bram +2 checked in');
    expect(feedIsAccent(e)).toBe(true);
  });
  it('labels a check-out without accent', () => {
    const e: FeedEntry = { kind: 'out', t: '23:11', name: 'Bram', plus: 0 };
    expect(liveFeedLabel(e)).toBe('Bram checked out');
    expect(feedIsAccent(e)).toBe(false);
  });
  it('passes a message entry through', () => {
    const e: FeedEntry = { kind: 'msg', t: '23:12', msg: 'Lisa goedgekeurd', accent: true };
    expect(liveFeedLabel(e)).toBe('Lisa goedgekeurd');
    expect(feedIsAccent(e)).toBe(true);
  });
});
