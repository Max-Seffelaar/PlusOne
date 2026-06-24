import { describe, it, expect } from 'vitest';
import {
  eventWhen,
  guestStatusToPo,
  notePriorityToFlag,
  optimisticGuest,
  tierRole,
  toPoEvent,
  toPoHome,
  toPoGuest,
  toPoTier,
  toPoContact,
  contactRoleToPo,
  relativeTime,
  toPoGuestRequest,
  toPoQuotaRequest,
  toRecap,
  toRecapGuest,
  rolesLabel,
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
  PoContactRow,
  RecapGuestRow,
  PoMemberRow,
  PoInviteRow,
  PoSessionRow,
  PoProfileRow,
  PoVenueSettingsRow,
  PoSubscriptionRow,
  PoGuestRequestRow,
  PoQuotaRequestRow,
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

describe('toPoHome', () => {
  // 22:00Z on 14 Dec = 23:00 Amsterdam, same calendar day as NOW (19:00 Amsterdam).
  // registered/present are the role-scoped headcounts the home receives directly.
  const baseEvent: PoEventRow = {
    id: 'e1',
    name: 'FRENZY',
    starts_at: '2024-12-14T22:00:00Z',
    ends_at: null,
    status: 'live',
    list_locked: true,
    venue_name: 'De Marktkantine',
  };
  const boundedQuota = { quota: 20, consumed: 8, remaining: 12, exempt: false };
  const NOW = Date.parse('2024-12-14T18:00:00Z');

  it('maps a live event: headcounts, onderweg, attendance, status label', () => {
    const v = toPoHome({ ...baseEvent, registered: 148, present: 47 }, 3, boundedQuota, NOW);
    expect(v.scenario).toBe('live');
    expect(v.statusLabel).toBe('Live now');
    expect(v.inside).toBe(47);
    expect(v.registered).toBe(148);
    expect(v.walking).toBe(101); // registered − present
    expect(v.attendancePct).toBe(32); // round(47/148*100)
    expect(v.requests).toBe(3);
    expect(v.locked).toBe(true);
    expect(v.daysUntil).toBe(0);
    expect(v.dateLabel).toBe('Sat 14 Dec');
    expect(v.time).toBe('23:00');
    expect(v).toMatchObject({ quotaFree: 12, quotaTotal: 20, quotaConsumed: 8, quotaExempt: false, quotaKnown: true });
  });

  it('maps an open event starting today to the pre-event (deur dicht) scenario', () => {
    const v = toPoHome({ ...baseEvent, status: 'open', registered: 148, present: 0 }, 5, boundedQuota, NOW);
    expect(v.scenario).toBe('pre');
    expect(v.statusLabel).toBe('Tonight · doors closed');
    expect(v.inside).toBe(0);
    expect(v.attendancePct).toBe(0);
    expect(v.requests).toBe(5);
  });

  it('maps an open event on a future day to the quiet scenario with daysUntil', () => {
    const v = toPoHome(
      {
        ...baseEvent,
        name: 'Hunée',
        status: 'open',
        starts_at: '2024-12-20T21:00:00Z',
        list_locked: false,
        venue_name: 'Paradiso',
        registered: 96,
        present: 0,
      },
      2,
      boundedQuota,
      NOW
    );
    expect(v.scenario).toBe('quiet');
    expect(v.statusLabel).toBe('Nothing live');
    expect(v.daysUntil).toBe(6);
    expect(v.registered).toBe(96);
    expect(v.locked).toBe(false);
  });

  it('treats an exempt quota as no limit (quotaFree null, still known)', () => {
    const v = toPoHome(
      { ...baseEvent, registered: 148, present: 47 },
      0,
      { quota: -1, consumed: 42, remaining: null, exempt: true },
      NOW
    );
    expect(v.quotaExempt).toBe(true);
    expect(v.quotaFree).toBeNull();
    expect(v.quotaKnown).toBe(true);
  });

  it('handles a missing quota and zero counts without dividing by zero', () => {
    const v = toPoHome({ ...baseEvent, registered: 0, present: 0 }, 0, null, NOW);
    expect(v.inside).toBe(0);
    expect(v.registered).toBe(0);
    expect(v.walking).toBe(0);
    expect(v.attendancePct).toBe(0);
    expect(v.quotaKnown).toBe(false);
    expect(v.quotaFree).toBeNull();
  });
});

describe('guestStatusToPo', () => {
  it('maps checked_in to in, refused to refused, the rest to wait', () => {
    expect(guestStatusToPo('checked_in')).toBe('in');
    expect(guestStatusToPo('refused')).toBe('refused');
    for (const s of ['pending', 'approved', 'denied', 'removed'] as const) {
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
    contact_id: 'c1',
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
      contactId: 'c1',
    });
    expect(g.addedAt).toBe('28 Nov');
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
    expect(rolesLabel(['finance', 'admin'])).toBe('Admin · Finance');
    expect(rolesLabel(['staff'])).toBe('Staff');
  });
  it('falls back when no roles', () => {
    expect(rolesLabel([])).toBe('No role');
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
      rolesLabel: 'Admin · Finance',
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
      addedAt: '14 Dec',
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

describe('contactRoleToPo', () => {
  it('maps each contact_role to its po badge and null to Gast', () => {
    expect(contactRoleToPo('vip')).toBe('VIP');
    expect(contactRoleToPo('all_access')).toBe('All Access');
    expect(contactRoleToPo('artist')).toBe('Artist');
    expect(contactRoleToPo('press')).toBe('Pers');
    expect(contactRoleToPo('crew')).toBe('Crew');
    expect(contactRoleToPo('guest')).toBe('Gast');
    expect(contactRoleToPo(null)).toBe('Gast');
  });
});

describe('toPoContact', () => {
  const base: PoContactRow = {
    id: 'c1',
    full_name: 'Anouk Smit',
    email: 'anouk@mail.nl',
    phone: '+31612345678',
    birthdate: '1996-04-12',
    preferred_role: 'vip',
    note: 'Vaste klant',
    is_permanent: true,
    eventCount: 21,
  };
  it('maps the row, keeps only the last 4 phone digits, and carries the raw edit fields', () => {
    expect(toPoContact(base)).toEqual({
      id: 'c1',
      name: 'Anouk Smit',
      role: 'VIP',
      events: 21,
      vast: true,
      phoneLast4: '5678',
      email: 'anouk@mail.nl',
      phone: '+31612345678',
      birthdate: '1996-04-12',
      note: 'Vaste klant',
      preferredRole: 'vip',
    });
  });
  it('yields null phoneLast4 when there is no usable phone and Gast for a null role', () => {
    const c = toPoContact({ ...base, phone: null, preferred_role: null, is_permanent: false, eventCount: 0 });
    expect(c).toMatchObject({ role: 'Gast', vast: false, events: 0, phoneLast4: null, preferredRole: null });
  });
  it('strips non-digits before taking the last 4', () => {
    expect(toPoContact({ ...base, phone: '06 12 34 56 78' }).phoneLast4).toBe('5678');
    expect(toPoContact({ ...base, phone: '123' }).phoneLast4).toBeNull();
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
    expect(iv).toMatchObject({ id: 'i1', email: 'nieuw@venue.nl', roles: ['doorhost'], rolesLabel: 'Door host' });
    expect(iv.sentAt).toBe('3 Dec');
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
  it('shows "Active now" for the current session', () => {
    expect(toPoSession({ ...base, is_current: true })).toMatchObject({ id: 's1', current: true, last: 'Active now', where: '84.12.0.1' });
  });
  it('formats last-seen for other sessions and handles a missing ip', () => {
    const se = toPoSession({ ...base, ip: null });
    expect(se.current).toBe(false);
    expect(se.where).toBe('Unknown location');
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
      roleLabel: 'Admin',
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
    allow_uncheck: true,
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
      allowUncheck: true,
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
      period: 'month',
      status: 'active',
      renews: '1 Jan 2025',
      events: 'Unlimited',
      venueLabel: 'LOFI',
    });
  });
  it('handles an unknown/absent plan and no renewal date', () => {
    const row: PoSubscriptionRow = { status: 'trialing', plan_id: null, current_period_end: null };
    expect(toPoSubscription(row, 'LOFI')).toMatchObject({ plan: 'No subscription', priceLabel: '—', renews: '—', status: 'trialing' });
  });
  it('labels an indie plan as a single active event', () => {
    const row: PoSubscriptionRow = { status: 'comped', plan_id: 'indie', current_period_end: null };
    expect(toPoSubscription(row, 'LOFI')).toMatchObject({ plan: 'Indie', priceLabel: 'Free', events: '1 active event' });
  });
  it('humanises an out-of-catalog plan id (e.g. the seed pilot/comped venue)', () => {
    const row: PoSubscriptionRow = { status: 'comped', plan_id: 'pilot', current_period_end: null };
    expect(toPoSubscription(row, 'Club Vesper')).toMatchObject({ plan: 'Pilot', priceLabel: '—', status: 'comped' });
  });
});

describe('relativeTime', () => {
  // Fixed reference instant so the buckets are deterministic.
  const now = new Date('2024-11-23T22:00:00Z');
  const ago = (ms: number): string => new Date(now.getTime() - ms).toISOString();

  it('buckets sub-minute as "just now" and minutes/hours/days in English', () => {
    expect(relativeTime(ago(30_000), now)).toBe('just now');
    expect(relativeTime(ago(18 * 60_000), now)).toBe('18 min ago');
    expect(relativeTime(ago(3 * 3_600_000), now)).toBe('3 hr ago');
    expect(relativeTime(ago(26 * 3_600_000), now)).toBe('yesterday');
    expect(relativeTime(ago(3 * 86_400_000), now)).toBe('3 days ago');
  });

  it('falls back to an absolute short date past a week (Europe/Amsterdam)', () => {
    expect(relativeTime('2024-11-12T10:00:00Z', now)).toBe('12 Nov');
  });

  it('treats a future timestamp (clock skew) as "just now"', () => {
    expect(relativeTime(ago(-60_000), now)).toBe('just now');
  });
});

describe('toPoGuestRequest', () => {
  const now = new Date('2024-11-23T22:00:00Z');
  const base: PoGuestRequestRow = {
    id: 'gr1',
    event_id: 'ee1',
    full_name: 'Mara Visser',
    phone: '+31612344821',
    plus_ones: 1,
    motivation: 'Vriendin van de DJ',
    created_at: new Date(now.getTime() - 18 * 60_000).toISOString(),
    status: 'pending',
    decision_reason: null,
  };

  it('maps a pending row, masks the phone to its last 4, and formats the time', () => {
    expect(toPoGuestRequest(base, now)).toEqual({
      id: 'gr1',
      eventId: 'ee1',
      name: 'Mara Visser',
      plus: 1,
      phoneLast4: '4821',
      motivation: 'Vriendin van de DJ',
      at: '18 min ago',
      status: 'pending',
      denyReason: null,
      flag: undefined,
    });
  });

  it('surfaces the refusal reason only for a denied row', () => {
    const denied = toPoGuestRequest({ ...base, status: 'denied', decision_reason: 'Lijst vol' }, now);
    expect(denied).toMatchObject({ status: 'denied', denyReason: 'Lijst vol' });
    // A pending row never carries a stale reason even if the column is set.
    const pending = toPoGuestRequest({ ...base, status: 'pending', decision_reason: 'Lijst vol' }, now);
    expect(pending).toMatchObject({ status: 'pending', denyReason: null });
  });

  it('flags a large party (+3 or more) and tolerates a null phone/motivation', () => {
    const r = toPoGuestRequest({ ...base, phone: null, motivation: null, plus_ones: 3 }, now);
    expect(r).toMatchObject({ phoneLast4: null, motivation: '', flag: 'Groot gezelschap (+3)' });
  });

  it('does not mask a phone too short to yield 4 digits', () => {
    expect(toPoGuestRequest({ ...base, phone: '12' }, now).phoneLast4).toBeNull();
  });
});

describe('toPoQuotaRequest', () => {
  const now = new Date('2024-11-23T22:00:00Z');
  const row: PoQuotaRequestRow = {
    id: 'qr1',
    eventId: 'ee1',
    requestedExtra: 3,
    motivation: 'Twee extra promo-koppels',
    created_at: new Date(now.getTime() - 2 * 3_600_000).toISOString(),
    requesterName: 'Joris Willems',
  };

  it('maps the requester, extra count, reason, and relative time', () => {
    expect(toPoQuotaRequest(row, now)).toEqual({
      id: 'qr1',
      eventId: 'ee1',
      who: 'Joris Willems',
      extra: 3,
      reason: 'Twee extra promo-koppels',
      at: '2 hr ago',
    });
  });

  it('collapses a null motivation to an empty reason', () => {
    expect(toPoQuotaRequest({ ...row, motivation: null }, now).reason).toBe('');
  });
});
