import { describe, expect, it } from 'vitest';
import { doorCandidates, pickDoorEvent } from './door-event';
import type { PoEventRow } from './queries';

type Status = PoEventRow['status'];

const NOW = new Date('2026-06-19T20:00:00Z').getTime();

function row(id: string, status: Status, startsAt: string): PoEventRow {
  return {
    id,
    name: `Event ${id}`,
    starts_at: startsAt,
    ends_at: null,
    status,
    list_locked: false,
    venue_name: 'De Marktkantine',
  };
}

describe('pickDoorEvent', () => {
  it('returns null when there are no events', () => {
    expect(pickDoorEvent([], NOW)).toBeNull();
  });

  it('returns null when every event is closed', () => {
    const rows = [row('a', 'closed', '2026-06-10T20:00:00Z'), row('b', 'closed', '2026-06-01T20:00:00Z')];
    expect(pickDoorEvent(rows, NOW)).toBeNull();
  });

  it('prefers a live event over upcoming ones', () => {
    const rows = [
      row('upcoming', 'open', '2026-06-25T20:00:00Z'),
      row('live', 'live', '2026-06-19T18:00:00Z'),
    ];
    expect(pickDoorEvent(rows, NOW)?.id).toBe('live');
  });

  it('picks the soonest upcoming event when none is live', () => {
    const rows = [
      row('far', 'open', '2026-07-10T20:00:00Z'),
      row('soon', 'draft', '2026-06-21T20:00:00Z'),
      row('past', 'closed', '2026-06-01T20:00:00Z'),
    ];
    expect(pickDoorEvent(rows, NOW)?.id).toBe('soon');
  });

  it('falls back to the most recent still-open event when none is upcoming', () => {
    const rows = [
      row('older', 'open', '2026-06-10T20:00:00Z'),
      row('newer', 'open', '2026-06-18T20:00:00Z'),
      row('closed', 'closed', '2026-06-19T19:00:00Z'),
    ];
    // Both open events already started (before NOW); the most recent one wins.
    expect(pickDoorEvent(rows, NOW)?.id).toBe('newer');
  });

  it('maps the chosen row to the lean door-event shape', () => {
    const rows = [row('live', 'live', '2026-06-19T18:00:00Z')];
    expect(pickDoorEvent(rows, NOW)).toEqual({
      id: 'live',
      name: 'Event live',
      venueName: 'De Marktkantine',
      status: 'live',
    });
  });
});

describe('doorCandidates (S1.3 event switcher)', () => {
  it('drops closed events and orders live first, then soonest start', () => {
    const rows = [
      row('far', 'open', '2026-07-10T20:00:00Z'),
      row('closed', 'closed', '2026-06-19T19:00:00Z'),
      row('liveB', 'live', '2026-06-19T22:00:00Z'),
      row('soon', 'draft', '2026-06-21T20:00:00Z'),
      row('liveA', 'live', '2026-06-19T18:00:00Z'),
    ];
    // Two live events first (soonest start among them), then the rest by start; closed gone.
    expect(doorCandidates(rows).map((e) => e.id)).toEqual(['liveA', 'liveB', 'soon', 'far']);
  });

  it('is empty when every event is closed', () => {
    expect(doorCandidates([row('a', 'closed', '2026-06-10T20:00:00Z')])).toEqual([]);
  });
});
