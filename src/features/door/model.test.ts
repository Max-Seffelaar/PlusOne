import { describe, expect, it } from 'vitest';
import { buildDoorView, buildTasks, indexCheckIns, lastFour, tierRole } from './model';
import type { CheckInRow, DoorSnapshot, GuestRow, RefusalRow, TierRow } from './queries';

function tier(over: Partial<TierRow> = {}): TierRow {
  return {
    id: 't-reg',
    event_id: 'ev1',
    name: 'Regular',
    description: null,
    color: '#8A8A93',
    max_guests: null,
    aliases: [],
    door_price_cents: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

function guest(over: Partial<GuestRow> = {}): GuestRow {
  return {
    id: 'g1',
    event_id: 'ev1',
    tier_id: 't-reg',
    full_name: 'Tess Bakker',
    email: null,
    phone: null,
    contact_id: null,
    plus_ones: 0,
    note: null,
    note_priority: 'none',
    note_acknowledged_by: null,
    note_acknowledged_at: null,
    added_by: 'u-max',
    source: 'app',
    status: 'approved',
    request_link_id: null,
    anonymized_at: null,
    removed_at: null,
    created_at: '2026-06-10T12:00:00Z',
    updated_at: '2026-06-10T12:00:00Z',
    ...over,
  };
}

function checkIn(over: Partial<CheckInRow> = {}): CheckInRow {
  return {
    id: 'ci1',
    guest_id: 'g1',
    event_id: 'e1',
    venue_id: 'v1',
    checked_by: 'u-lisa',
    checked_at: '2026-06-20T23:41:00Z',
    client_timestamp: null,
    device_id: null,
    plus_ones_arrived: 0,
    offline_synced: false,
    created_at: '2026-06-20T23:41:00Z',
    voided_at: null,
    voided_by: null,
    ...over,
  };
}

function refusal(over: Partial<RefusalRow> = {}): RefusalRow {
  return {
    id: 'r1',
    guest_id: 'g1',
    event_id: 'e1',
    venue_id: 'v1',
    refused_by: 'u-lisa',
    reason: 'Niet op de lijst',
    refused_at: '2026-06-21T00:03:00Z',
    client_timestamp: null,
    device_id: null,
    created_at: '2026-06-21T00:03:00Z',
    anonymized_at: null,
    ...over,
  };
}

function snapshot(over: Partial<DoorSnapshot> = {}): DoorSnapshot {
  return {
    event: { id: 'ev1', venueId: 'v1', name: 'FRENZY', venueName: 'De Marktkantine', status: 'open', listLocked: false, allowUncheck: true },
    guests: [],
    tiers: [tier(), tier({ id: 't-vip', name: 'VIP — fles op tafel', color: '#B5A6FF' })],
    checkIns: [],
    refusals: [],
    profiles: { 'u-max': 'Max', 'u-lisa': 'Lisa' },
    fetchedAt: '2026-06-20T22:00:00Z',
    ...over,
  };
}

describe('lastFour (#27)', () => {
  it('returns the last four digits, ignoring formatting', () => {
    expect(lastFour('+31 6 12 34 56 78')).toBe('5678');
    expect(lastFour('06-1234')).toBe('1234');
  });
  it('handles missing or short numbers', () => {
    expect(lastFour(null)).toBeNull();
    expect(lastFour('12')).toBe('12');
  });
});

describe('tierRole', () => {
  it('maps known tiers to a glyph + short label', () => {
    expect(tierRole('VIP — fles op tafel')).toEqual({ label: 'VIP', icon: 'crown' });
    expect(tierRole('All Access')).toEqual({ label: 'All Access', icon: 'shield' });
    expect(tierRole('Crew & productie')).toEqual({ label: 'Crew', icon: 'users' });
  });
  it('keeps a short free-form name as-is', () => {
    expect(tierRole('Regular')).toEqual({ label: 'Regular', icon: 'user' });
  });
});

describe('indexCheckIns (#11 first wins)', () => {
  it('keeps the earliest check-in per guest', () => {
    const map = indexCheckIns([
      checkIn({ id: 'late', checked_at: '2026-06-20T23:50:00Z' }),
      checkIn({ id: 'early', checked_at: '2026-06-20T23:40:00Z' }),
    ]);
    expect(map.get('g1')?.id).toBe('early');
  });
});

describe('buildDoorView', () => {
  it('derives inside from a check-in row and fills the logboek fields', () => {
    const view = buildDoorView(
      snapshot({
        guests: [guest({ id: 'g1', phone: '+31612345678', plus_ones: 2 })],
        checkIns: [checkIn({ guest_id: 'g1', checked_by: 'u-lisa', plus_ones_arrived: 2 })],
      }),
    );
    expect(view.guests).toHaveLength(1);
    const g = view.guests[0];
    expect(g.inside).toBe(true);
    expect(g.inByName).toBe('Lisa');
    expect(g.arrived).toBe(2);
    expect(g.addedByName).toBe('Max');
    expect(g.last4).toBe('5678');
    expect(view.insideCount).toBe(1);
    expect(view.waitingCount).toBe(0);
  });

  it('totals both gasten (rows) and koppen (heads), splitting a partial party (S1.3)', () => {
    const view = buildDoorView(
      snapshot({
        guests: [
          guest({ id: 'g1', plus_ones: 2 }), // +2 party (3 koppen)
          guest({ id: 'g2', full_name: 'Sam', plus_ones: 0 }), // solo, onderweg
        ],
        checkIns: [checkIn({ guest_id: 'g1', plus_ones_arrived: 1 })], // 2 of 3 present
      }),
    );
    // Rows: g1 inside, g2 onderweg.
    expect(view.insideCount).toBe(1);
    expect(view.waitingCount).toBe(1);
    // Koppen: g1 = 2 inside (self + 1) and 1 onderweg; g2 = 1 onderweg → 2 in / 2 onderweg.
    expect(view.insideHeadcount).toBe(2);
    expect(view.waitingHeadcount).toBe(2);
  });

  it('treats a voided check-in as not inside — back to onderweg (soft void #3)', () => {
    const view = buildDoorView(
      snapshot({
        guests: [guest({ id: 'g1', plus_ones: 2 })],
        checkIns: [checkIn({ guest_id: 'g1', plus_ones_arrived: 2, voided_at: '2026-06-20T23:55:00Z', voided_by: 'u-lisa' })],
      }),
    );
    const g = view.guests[0];
    expect(g.inside).toBe(false);
    expect(g.voided).toBe(true);
    expect(g.arrived).toBeUndefined();
    expect(view.insideCount).toBe(0);
    expect(view.waitingCount).toBe(1);
  });

  it('splits refused guests (status-based) into view.refused with the latest reason', () => {
    const view = buildDoorView(
      snapshot({
        guests: [guest({ id: 'g1' }), guest({ id: 'g2', full_name: 'Bram de Groot', status: 'refused' })],
        refusals: [refusal({ guest_id: 'g2', reason: 'Geen geldig ID' })],
      }),
    );
    expect(view.guests.map((g) => g.id)).toEqual(['g1']);
    expect(view.refused.map((g) => g.id)).toEqual(['g2']);
    expect(view.refused[0].refused).toBe(true);
    expect(view.refused[0].refusedReason).toBe('Geen geldig ID');
  });

  it('keeps a re-admitted guest active even though a refusal row remains (undo)', () => {
    const view = buildDoorView(
      snapshot({
        // status back to 'approved' after "ongedaan maken"; the refusal stays in history.
        guests: [guest({ id: 'g1', status: 'approved' })],
        refusals: [refusal({ guest_id: 'g1' })],
      }),
    );
    expect(view.guests.map((g) => g.id)).toEqual(['g1']);
    expect(view.refused).toHaveLength(0);
  });

  it('applies the tier colour from guest_tiers', () => {
    const view = buildDoorView(snapshot({ guests: [guest({ tier_id: 't-vip' })] }));
    expect(view.guests[0].tierColor).toBe('#B5A6FF');
    expect(view.guests[0].tierName).toBe('VIP');
  });
});

describe('buildTasks (#39)', () => {
  it('lists guests with a note, high priority flagged, acknowledged = done', () => {
    const view = buildDoorView(
      snapshot({
        guests: [
          guest({ id: 'g1', note: 'Tafel reserveren', note_priority: 'high' }),
          guest({ id: 'g2', note: 'Komt later', note_priority: 'low', note_acknowledged_at: '2026-06-20T23:00:00Z', note_acknowledged_by: 'u-lisa' }),
          guest({ id: 'g3', note: null }),
        ],
      }),
    );
    const tasks = buildTasks(view);
    expect(tasks.map((t) => t.guest.id)).toEqual(['g1', 'g2']);
    expect(tasks.find((t) => t.guest.id === 'g1')).toMatchObject({ high: true, done: false });
    expect(tasks.find((t) => t.guest.id === 'g2')).toMatchObject({ high: false, done: true });
  });
});
