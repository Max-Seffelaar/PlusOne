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
  rolesLabel,
  deviceLabel,
  toPoTeamMember,
  toPoInvite,
  toPoSession,
  toPoProfile,
  toPoVenueSettings,
  toPoSubscription,
  type EventCounts,
} from './adapters';
import type {
  PoEventRow,
  PoGuestRow,
  PoTierRow,
  RecapGuestRow,
  PoMemberRow,
  PoInviteRow,
  PoSessionRow,
  PoProfileRow,
  PoVenueSettingsRow,
  PoSubscriptionRow,
} from './queries';
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

// ── Settings adapters (S6/S7/S8 + billing) ───────────────────────────────────

describe('rolesLabel', () => {
  it('joins role labels in canonical order', () => {
    expect(rolesLabel(['finance', 'admin'])).toBe('Beheerder · Financiën');
    expect(rolesLabel(['staff'])).toBe('Personeel');
  });
  it('falls back when no roles', () => {
    expect(rolesLabel([])).toBe('Geen rol');
  });
});

describe('toPoTeamMember', () => {
  const row: PoMemberRow = {
    user_id: 'u1',
    full_name: 'Sanne de Vries',
    email: 'sanne@venue.nl',
    roles: ['admin', 'finance'],
    job_title: null,
  };
  it('carries ids/roles and the effective quota', () => {
    expect(toPoTeamMember(row, 10)).toEqual({
      userId: 'u1',
      name: 'Sanne de Vries',
      email: 'sanne@venue.nl',
      roles: ['admin', 'finance'],
      rolesLabel: 'Beheerder · Financiën',
      quota: 10,
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

describe('toPoInvite', () => {
  const row: PoInviteRow = {
    id: 'i1',
    email: 'nieuw@venue.nl',
    roles: ['doorhost'],
    expires_at: '2025-01-10T12:00:00Z',
    created_at: '2024-12-03T12:00:00Z',
  };
  it('formats the sent date (Amsterdam) and labels roles', () => {
    const iv = toPoInvite(row);
    expect(iv).toMatchObject({ id: 'i1', email: 'nieuw@venue.nl', roles: ['doorhost'], rolesLabel: 'Deurhost' });
    expect(iv.sentAt).toBe('3 dec');
  });
});

describe('deviceLabel', () => {
  it('derives browser + OS from the UA', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari')).toBe('Safari · iPhone');
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari')).toBe('Chrome · Windows');
    expect(deviceLabel('Mozilla/5.0 (Macintosh) Firefox/120')).toBe('Firefox · Mac');
  });
  it('falls back when the UA is absent', () => {
    expect(deviceLabel(null)).toBe('Onbekend apparaat');
  });
});

describe('toPoSession', () => {
  const base: PoSessionRow = {
    session_id: 's1',
    created_at: '2024-11-23T20:00:00Z',
    updated_at: '2024-11-23T22:30:00Z', // 23:30 Amsterdam (CET)
    not_after: null,
    user_agent: 'Mozilla/5.0 (iPhone) Safari',
    ip: '84.12.0.1',
    aal: 'aal1',
    is_current: false,
  };
  it('shows "Nu actief" for the current session', () => {
    expect(toPoSession({ ...base, is_current: true })).toMatchObject({ id: 's1', current: true, last: 'Nu actief', where: '84.12.0.1' });
  });
  it('formats last-seen for other sessions and handles a missing ip', () => {
    const se = toPoSession({ ...base, ip: null });
    expect(se.current).toBe(false);
    expect(se.where).toBe('Onbekende locatie');
    expect(se.last).toContain('23:30');
  });
});

describe('toPoProfile', () => {
  const row: PoProfileRow = {
    id: 'u1',
    full_name: 'Max Seffelaar',
    first_name: 'Max',
    last_name: 'Seffelaar',
    email: 'max@venue.nl',
    phone: '0612345678',
  };
  it('maps the profile and flags MFA for admin', () => {
    expect(toPoProfile(row, ['admin'])).toEqual({
      userId: 'u1',
      name: 'Max Seffelaar',
      firstName: 'Max',
      lastName: 'Seffelaar',
      email: 'max@venue.nl',
      phone: '0612345678',
      roleLabel: 'Beheerder',
      mfaRequired: true,
    });
  });
  it('does not require MFA for staff and defaults null name parts to empty', () => {
    const p = toPoProfile({ ...row, first_name: null, last_name: null, phone: null }, ['staff']);
    expect(p).toMatchObject({ firstName: '', lastName: '', phone: '', mfaRequired: false });
  });
});

describe('toPoVenueSettings', () => {
  const row: PoVenueSettingsRow = {
    id: 'v1',
    name: 'LOFI',
    slug: 'lofi',
    retention_months: 12,
    default_personal_quota: 5,
    company_name: null,
    kvk_number: null,
    vat_number: null,
    finance_email: null,
    address_line: null,
    postal_code: null,
    city: null,
    country: 'NL',
  };
  it('coalesces nullable company/address fields to empty strings', () => {
    expect(toPoVenueSettings(row)).toEqual({
      id: 'v1',
      name: 'LOFI',
      slug: 'lofi',
      retentionMonths: 12,
      defaultPersonalQuota: 5,
      companyName: '',
      kvkNumber: '',
      vatNumber: '',
      financeEmail: '',
      addressLine: '',
      postalCode: '',
      city: '',
      country: 'NL',
    });
  });
});

describe('toPoSubscription', () => {
  it('returns null when there is no subscription row', () => {
    expect(toPoSubscription(null, 'LOFI')).toBeNull();
  });
  it('resolves the plan via the catalog and formats the renewal', () => {
    const row: PoSubscriptionRow = { status: 'active', plan_id: 'premium', current_period_end: '2025-01-01T00:00:00Z' };
    expect(toPoSubscription(row, 'LOFI')).toEqual({
      plan: 'Premium',
      priceLabel: '€49',
      period: 'maand',
      status: 'active',
      renews: '1 jan 2025',
      events: 'Onbeperkt',
      venueLabel: 'LOFI',
    });
  });
  it('handles an unknown/absent plan and no renewal date', () => {
    const row: PoSubscriptionRow = { status: 'trialing', plan_id: null, current_period_end: null };
    expect(toPoSubscription(row, 'LOFI')).toMatchObject({ plan: 'Geen abonnement', priceLabel: '—', renews: '—', status: 'trialing' });
  });
  it('labels an indie plan as a single active event', () => {
    const row: PoSubscriptionRow = { status: 'comped', plan_id: 'indie', current_period_end: null };
    expect(toPoSubscription(row, 'LOFI')).toMatchObject({ plan: 'Indie', priceLabel: 'Gratis', events: '1 actief event' });
  });
  it('humanises an out-of-catalog plan id (e.g. the seed pilot/comped venue)', () => {
    const row: PoSubscriptionRow = { status: 'comped', plan_id: 'pilot', current_period_end: null };
    expect(toPoSubscription(row, 'Club Vesper')).toMatchObject({ plan: 'Pilot', priceLabel: '—', status: 'comped' });
  });
});
