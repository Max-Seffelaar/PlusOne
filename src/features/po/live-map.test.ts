import { describe, expect, it } from 'vitest';
import type { Database } from '@/lib/database.types';
import { aggregateGuestCounts, eventDateParts, toPoEvent } from './live-map';

type EventRow = Database['public']['Tables']['events']['Row'];

function makeEvent(over: Partial<EventRow>): EventRow {
  return {
    id: 'e1',
    venue_id: 'v1',
    name: 'Launch Night',
    starts_at: '2026-06-20T23:00:00+02:00',
    ends_at: '2026-06-21T05:00:00+02:00',
    status: 'open',
    list_locked: false,
    landing_active: true,
    landing_slug: 'launch',
    locked_at: null,
    locked_by: null,
    went_live_at: null,
    created_at: '2026-06-01T00:00:00Z',
    updated_at: '2026-06-01T00:00:00Z',
    ...over,
  };
}

describe('eventDateParts (Europe/Amsterdam, NL)', () => {
  it('formats the seed event start into date chips', () => {
    expect(eventDateParts('2026-06-20T23:00:00+02:00')).toEqual({
      date: '20',
      mon: 'JUN',
      month: 'Juni 2026',
      time: '23:00',
    });
  });
});

describe('aggregateGuestCounts', () => {
  it('counts heads per event, excludes removed, counts checked_in as inside', () => {
    const counts = aggregateGuestCounts([
      { event_id: 'e1', status: 'approved', plus_ones: 2 },
      { event_id: 'e1', status: 'checked_in', plus_ones: 0 },
      { event_id: 'e1', status: 'removed', plus_ones: 1 }, // soft-deleted: ignored (#21)
      { event_id: 'e2', status: 'pending', plus_ones: 0 },
    ]);
    expect(counts.get('e1')).toEqual({ guests: 2, inside: 1 });
    expect(counts.get('e2')).toEqual({ guests: 1, inside: 0 });
  });
});

describe('toPoEvent', () => {
  const now = new Date('2026-06-15T12:00:00Z');

  it('marks a not-yet-ended event as upcoming and carries counts', () => {
    const po = toPoEvent(makeEvent({}), 'Club Vesper', { guests: 7, inside: 3 }, now);
    expect(po).toMatchObject({ venue: 'Club Vesper', guests: 7, inside: 3, when: 'upcoming', accent: false });
  });

  it('marks an event that already ended as past', () => {
    const po = toPoEvent(
      makeEvent({ starts_at: '2026-06-01T23:00:00+02:00', ends_at: '2026-06-02T05:00:00+02:00' }),
      'Club Vesper',
      undefined,
      now,
    );
    expect(po.when).toBe('past');
    expect(po.guests).toBe(0); // no counts → zeroed, never NaN
  });

  it('accents a live event', () => {
    expect(toPoEvent(makeEvent({ status: 'live' }), 'V', undefined, now).accent).toBe(true);
  });
});
