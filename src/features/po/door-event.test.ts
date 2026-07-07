import { describe, expect, it } from 'vitest';
import { doorCandidates, pickDoorEvent } from './door-event';
import type { PoEventRow } from './queries';

// NOW sits 2h after an 18:00 start (inside the 8h live grace) and before the
// 20:00+ ones, so "live" is purely time-derived now (the status machine is gone).
const NOW = new Date('2026-06-19T20:00:00Z').getTime();

function row(
  id: string,
  startsAt: string,
  opts: { cancelled?: boolean; endsAt?: string | null } = {},
): PoEventRow {
  return {
    id,
    name: `Event ${id}`,
    starts_at: startsAt,
    ends_at: opts.endsAt ?? null,
    status: 'open', // vestigial — selection is time + cancelled now
    cancelled_at: opts.cancelled ? '2026-06-01T00:00:00Z' : null,
    list_locked: false,
    venue_name: 'De Marktkantine',
  };
}

describe('pickDoorEvent', () => {
  it('returns null when there are no events', () => {
    expect(pickDoorEvent([], NOW)).toBeNull();
  });

  it('returns null when every event is cancelled', () => {
    const rows = [
      row('a', '2026-06-10T20:00:00Z', { cancelled: true }),
      row('b', '2026-06-01T20:00:00Z', { cancelled: true }),
    ];
    expect(pickDoorEvent(rows, NOW)).toBeNull();
  });

  it('prefers a live (in-progress) event over upcoming ones', () => {
    const rows = [
      row('upcoming', '2026-06-25T20:00:00Z'),
      row('live', '2026-06-19T18:00:00Z'),
    ];
    expect(pickDoorEvent(rows, NOW)?.id).toBe('live');
  });

  it('picks the soonest upcoming event when none is live', () => {
    const rows = [
      row('far', '2026-07-10T20:00:00Z'),
      row('soon', '2026-06-21T20:00:00Z'),
      row('past', '2026-06-01T20:00:00Z', { cancelled: true }),
    ];
    expect(pickDoorEvent(rows, NOW)?.id).toBe('soon');
  });

  it('falls back to the most recent started event when none is upcoming', () => {
    const rows = [
      row('older', '2026-06-10T20:00:00Z'),
      row('newer', '2026-06-18T20:00:00Z'),
      row('cancelled', '2026-06-19T19:00:00Z', { cancelled: true }),
    ];
    // Both non-cancelled events already started (before NOW); the most recent wins.
    expect(pickDoorEvent(rows, NOW)?.id).toBe('newer');
  });

  it('maps the chosen row to the lean door-event shape', () => {
    const rows = [row('live', '2026-06-19T18:00:00Z')];
    expect(pickDoorEvent(rows, NOW)).toEqual({
      id: 'live',
      name: 'Event live',
      venueName: 'De Marktkantine',
      phase: 'live',
    });
  });
});

describe('doorCandidates (S1.3 event switcher)', () => {
  it('drops cancelled events and orders live first, then soonest start', () => {
    const rows = [
      row('far', '2026-07-10T20:00:00Z'),
      row('cancelled', '2026-06-19T19:00:00Z', { cancelled: true }),
      row('upcomingB', '2026-06-19T22:00:00Z'),
      row('soon', '2026-06-21T20:00:00Z'),
      row('liveA', '2026-06-19T18:00:00Z'),
    ];
    // liveA is the only in-progress event → first; the rest by soonest start; cancelled gone.
    expect(doorCandidates(rows, NOW).map((e) => e.id)).toEqual(['liveA', 'upcomingB', 'soon', 'far']);
  });

  it('drops finished (past) events — the picker only offers live/future events', () => {
    const rows = [
      row('endedExplicit', '2026-06-18T20:00:00Z', { endsAt: '2026-06-19T02:00:00Z' }),
      row('graceElapsed', '2026-06-19T08:00:00Z'), // no end; 8h grace over by NOW (20:00)
      row('liveA', '2026-06-19T18:00:00Z'),
      row('upcomingB', '2026-06-19T22:00:00Z'),
    ];
    expect(doorCandidates(rows, NOW).map((e) => e.id)).toEqual(['liveA', 'upcomingB']);
  });

  it('is empty when every event is cancelled or past', () => {
    expect(doorCandidates([row('a', '2026-06-10T20:00:00Z', { cancelled: true })], NOW)).toEqual([]);
    expect(doorCandidates([row('b', '2026-06-01T20:00:00Z')], NOW)).toEqual([]);
  });
});
