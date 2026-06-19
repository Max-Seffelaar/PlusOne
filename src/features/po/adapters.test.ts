import { describe, it, expect } from 'vitest';
import {
  eventWhen,
  guestStatusToPo,
  notePriorityToFlag,
  optimisticGuest,
  tierRole,
  toPoEvent,
  toPoGuest,
  toPoTier,
  toRecap,
  toRecapGuest,
  type EventCounts,
} from './adapters';
import type { PoEventRow, PoGuestRow, PoTierRow, RecapGuestRow } from './queries';
import type { EventSummary, TierStat } from '@/features/stats/data';
import type { Tier } from '@/lib/po/types';

describe('eventWhen', () => {
  it('maps closed to past, everything else to upcoming', () => {
    expect(eventWhen('closed')).toBe('past');
    expect(eventWhen('draft')).toBe('upcoming');
    expect(eventWhen('open')).toBe('upcoming');
    expect(eventWhen('live')).toBe('upcoming');
  });
});

describe('guestStatusToPo', () => {
  it('maps checked_in to in, the rest to wait', () => {
    expect(guestStatusToPo('checked_in')).toBe('in');
    for (const s of ['pending', 'approved', 'denied', 'refused', 'removed'] as const) {
      expect(guestStatusToPo(s)).toBe('wait');
    }
  });
});

describe('notePriorityToFlag', () => {
  it('passes high/low through and collapses none to null', () => {
    expect(notePriorityToFlag('high')).toBe('high');
    expect(notePriorityToFlag('low')).toBe('low');
    expect(notePriorityToFlag('none')).toBeNull();
  });
});

describe('tierRole', () => {
  it('derives the role badge from the tier name', () => {
    expect(tierRole('VIP')).toBe('VIP');
    expect(tierRole('Artist')).toBe('Artist');
    expect(tierRole('All Access')).toBe('All Access');
    expect(tierRole('AA')).toBe('All Access');
    expect(tierRole('Pers')).toBe('Pers');
    expect(tierRole('Press')).toBe('Pers');
    expect(tierRole('Crew')).toBe('Crew');
    expect(tierRole('Regulier')).toBe('Gast');
  });
});

describe('toPoEvent', () => {
  const row: PoEventRow = {
    id: 'e1',
    name: 'LOFI Nightcap',
    starts_at: '2024-11-23T22:00:00Z', // 23:00 in Amsterdam (CET, winter)
    ends_at: null,
    status: 'closed',
    list_locked: false,
    venue_name: 'Lofi',
  };

  it('formats the date parts in Europe/Amsterdam and carries the counts', () => {
    const counts: EventCounts = { guests: 132, inside: 121 };
    expect(toPoEvent(row, counts)).toEqual({
      id: 'e1',
      name: 'LOFI Nightcap',
      venue: 'Lofi',
      time: '23:00',
      date: '23',
      mon: 'NOV',
      month: 'November 2024',
      guests: 132,
      inside: 121,
      when: 'past',
    });
  });
});

describe('toPoGuest', () => {
  const row: PoGuestRow = {
    id: 'g1',
    full_name: 'Lieke Hofman',
    plus_ones: 2,
    status: 'checked_in',
    tier_id: 't1',
    note: 'Tafel 4 reserveren',
    note_priority: 'high',
    created_at: '2024-11-28T12:00:00Z',
  };

  it('maps a guest row + extras to the po Guest shape', () => {
    const g = toPoGuest(row, { role: 'VIP', addedBy: 'Max' });
    expect(g).toMatchObject({
      id: 'g1',
      name: 'Lieke Hofman',
      role: 'VIP',
      pay: 'free',
      plus: 2,
      note: 'Tafel 4 reserveren',
      flag: 'high',
      by: 'Max',
      status: 'in',
    });
    expect(g.addedAt).toBe('28 nov');
  });

  it('defaults addedBy/note and maps a waiting guest', () => {
    const g = toPoGuest(
      { ...row, note: null, note_priority: 'none', status: 'pending' },
      { role: 'Gast' }
    );
    expect(g.by).toBe('');
    expect(g.note).toBe('');
    expect(g.flag).toBeNull();
    expect(g.status).toBe('wait');
  });
});

describe('toPoTier', () => {
  const row: PoTierRow = {
    id: 't1',
    name: 'VIP',
    color: '#FFD700',
    max_guests: 50,
    aliases: ['vip', 'v.i.p.'],
  };

  it('maps a tier row + used count to the po Tier shape', () => {
    expect(toPoTier(row, 12)).toEqual({
      id: 't1',
      name: 'VIP',
      short: 'VIP',
      role: 'VIP',
      color: '#FFD700',
      max: 50,
      used: 12,
      doorPrice: 0,
      aliases: ['vip', 'v.i.p.'],
    });
  });

  it('falls back to the accent colour when the tier has none', () => {
    expect(toPoTier({ ...row, color: null }, 0).color).toBe('#B5A6FF');
  });
});

describe('toRecapGuest', () => {
  it('maps role from the tier, check-in time, and who-added', () => {
    const g = toRecapGuest({
      id: 'g1',
      full_name: 'Anouk Smit',
      plus_ones: 2,
      status: 'checked_in',
      tierName: 'VIP — fles op tafel',
      addedByName: 'Max',
      checkedAt: '2024-11-09T22:14:00Z',
    });
    expect(g).toEqual({ name: 'Anouk Smit', plus: 2, role: 'VIP', at: expect.any(String), by: 'Max' });
  });

  it('leaves time/by undefined and defaults the role to Gast when unknown', () => {
    const g = toRecapGuest({
      id: 'g2',
      full_name: 'Bram Jansen',
      plus_ones: 0,
      status: 'approved',
      tierName: null,
      addedByName: null,
      checkedAt: null,
    });
    expect(g.at).toBeUndefined();
    expect(g.by).toBeUndefined();
    expect(g.role).toBe('Gast');
  });
});

describe('toRecap', () => {
  const summary: EventSummary = {
    attendance_pct: 71,
    no_shows: 1,
    peak_bucket: '2024-11-09T23:30:00Z',
    peak_count: 5,
    present: 2,
    present_headcount: 5,
    refused: 3,
    registered: 3,
    registered_headcount: 7,
  };
  const guests: RecapGuestRow[] = [
    { id: 'a', full_name: 'Late Arrival', plus_ones: 1, status: 'checked_in', tierName: 'VIP', addedByName: 'Max', checkedAt: '2024-11-09T23:50:00Z' },
    { id: 'b', full_name: 'Early Arrival', plus_ones: 0, status: 'checked_in', tierName: 'Crew', addedByName: 'Sanne', checkedAt: '2024-11-09T22:10:00Z' },
    { id: 'c', full_name: 'No Show', plus_ones: 0, status: 'approved', tierName: 'Regular', addedByName: 'Joris', checkedAt: null },
  ];
  const tiers: TierStat[] = [
    { color: '#B5A6FF', present: 2, present_headcount: 5, registered: 3, registered_headcount: 7, tier_id: 't1', tier_name: 'VIP' },
  ];

  it('pulls headcounts/refused/peak from the summary and splits the lists', () => {
    const r = toRecap(summary, guests, tiers);
    expect(r.listed).toBe(7);
    expect(r.arrived).toBe(5);
    expect(r.noShow).toBe(1);
    expect(r.refused).toBe(3);
    expect(r.peak).not.toBe('—');
    // checked-in guests are ordered by arrival time (ascending).
    expect(r.checkedIn.map((g) => g.name)).toEqual(['Early Arrival', 'Late Arrival']);
    expect(r.noShows.map((g) => g.name)).toEqual(['No Show']);
    expect(r.perTier).toEqual([{ tier: 'VIP', aangemeld: 7, binnen: 5 }]);
  });

  it('degrades to zeros and an em-dash peak when the summary is null', () => {
    expect(toRecap(null, [], [])).toMatchObject({
      listed: 0,
      arrived: 0,
      noShow: 0,
      refused: 0,
      peak: '—',
      checkedIn: [],
      noShows: [],
      perTier: [],
    });
  });
});

describe('optimisticGuest', () => {
  const tiers: Tier[] = [
    { id: 'vip', name: 'VIP', short: 'VIP', role: 'VIP', color: '#B5A6FF', max: null, used: 0, doorPrice: 0, aliases: [] },
    { id: 'reg', name: 'Regular', short: 'Gast', role: 'Gast', color: '#8E8E93', max: null, used: 0, doorPrice: 0, aliases: [] },
  ];
  const now = new Date('2024-12-14T12:00:00Z'); // 13:00 in Amsterdam (CET)

  it('builds a wait-status row with the tier role, client id and "d mmm" date', () => {
    expect(
      optimisticGuest({ id: 'g-1', tierId: 'vip', fullName: 'Juri Braakman', plusOnes: 2 }, tiers, now)
    ).toEqual({
      id: 'g-1',
      name: 'Juri Braakman',
      role: 'VIP',
      pay: 'free',
      plus: 2,
      note: '',
      flag: null,
      by: '',
      addedAt: '14 dec',
      status: 'wait',
    });
  });

  it('defaults role to Gast for an unknown tier, plus to 0, and synthesises an id', () => {
    const g = optimisticGuest({ tierId: 'nope', fullName: 'Noor de Wit' }, tiers, now);
    expect(g.role).toBe('Gast');
    expect(g.plus).toBe(0);
    expect(g.id).toBe('optimistic-Noor de Wit');
  });
});
