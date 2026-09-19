import { describe, expect, it } from 'vitest';
import { absentStage, defaultAddGuestEvent, defaultStatsEvent, eventPhase, eventWhenFromPhase, LIVE_GRACE_MS } from './event-phase';

const START = '2026-06-20T21:00:00Z';
const start = Date.parse(START);

describe('eventPhase', () => {
  it('is upcoming before the start', () => {
    expect(eventPhase(START, null, start - 60_000)).toBe('upcoming');
  });

  it('is live between an explicit start and end', () => {
    const end = '2026-06-21T05:00:00Z';
    expect(eventPhase(START, end, start + 60_000)).toBe('live');
    expect(eventPhase(START, end, Date.parse(end) - 60_000)).toBe('live');
  });

  it('is past after an explicit end', () => {
    const end = '2026-06-21T05:00:00Z';
    expect(eventPhase(START, end, Date.parse(end) + 60_000)).toBe('past');
  });

  it('with no end, stays live through the grace window then rolls to past', () => {
    expect(eventPhase(START, null, start + LIVE_GRACE_MS - 60_000)).toBe('live');
    expect(eventPhase(START, null, start + LIVE_GRACE_MS + 60_000)).toBe('past');
  });

  it('treats exactly start and exactly effective-end as live (inclusive)', () => {
    expect(eventPhase(START, null, start)).toBe('live');
    expect(eventPhase(START, null, start + LIVE_GRACE_MS)).toBe('live');
  });

  it('falls back to upcoming on an unparseable start', () => {
    expect(eventPhase('not-a-date', null, start)).toBe('upcoming');
  });

  it('ignores an unparseable end and uses the grace window', () => {
    expect(eventPhase(START, 'nonsense', start + 60_000)).toBe('live');
    expect(eventPhase(START, 'nonsense', start + LIVE_GRACE_MS + 60_000)).toBe('past');
  });
});

describe('eventWhenFromPhase', () => {
  it('collapses live + upcoming to the upcoming bucket and past to past', () => {
    expect(eventWhenFromPhase('upcoming')).toBe('upcoming');
    expect(eventWhenFromPhase('live')).toBe('upcoming');
    expect(eventWhenFromPhase('past')).toBe('past');
  });
});

describe('absentStage (z8uq9m0hw4: before = nothing, during = On the way, after = No-shows)', () => {
  it('hides the figure before the event starts', () => {
    expect(absentStage('upcoming')).toBe('hidden');
  });

  it('calls them "on the way" while the event runs', () => {
    expect(absentStage('live')).toBe('onTheWay');
  });

  it('only calls them no-shows once the event has ended', () => {
    expect(absentStage('past')).toBe('noShow');
  });

  it('follows the phase across the whole night, end boundary inclusive', () => {
    const end = '2026-06-21T05:00:00Z';
    const at = (ms: number): ReturnType<typeof absentStage> => absentStage(eventPhase(START, end, ms));
    expect(at(start - 1)).toBe('hidden');
    expect(at(start)).toBe('onTheWay');
    expect(at(Date.parse(end))).toBe('onTheWay');
    expect(at(Date.parse(end) + 1)).toBe('noShow');
  });
});

describe('defaultStatsEvent (Analytics opens on the most recent started event)', () => {
  const now = Date.parse('2026-09-18T20:00:00Z');
  const ev = (id: string, startsAt: string): { id: string; startsAt: string } => ({ id, startsAt });
  // Newest-first, as fetchVenueEvents orders them: the furthest-future event is [0].
  const list = [
    ev('next-month', '2026-10-18T21:00:00Z'),
    ev('next-week', '2026-09-25T21:00:00Z'),
    ev('tonight-later', '2026-09-18T21:00:00Z'),
    ev('last-week', '2026-09-11T21:00:00Z'),
    ev('last-month', '2026-08-18T21:00:00Z'),
  ];

  it('picks the most recent event that has started, not the furthest-future one', () => {
    expect(defaultStatsEvent(list, now)?.id).toBe('last-week');
  });

  it('picks a live event (started, not ended) over an older past one', () => {
    const live = [...list, ev('live-now', '2026-09-18T19:00:00Z')];
    expect(defaultStatsEvent(live, now)?.id).toBe('live-now');
  });

  it('counts an event starting exactly now as started', () => {
    expect(defaultStatsEvent([ev('a', '2026-09-18T20:00:00Z'), ev('b', '2026-09-30T20:00:00Z')], now)?.id).toBe('a');
  });

  it('falls back to the soonest upcoming event when nothing has started', () => {
    expect(defaultStatsEvent(list.slice(0, 3), now)?.id).toBe('tonight-later');
  });

  it('skips unparseable starts and is null for an empty list', () => {
    expect(defaultStatsEvent([ev('bad', 'nope'), ev('ok', '2026-09-01T20:00:00Z')], now)?.id).toBe('ok');
    expect(defaultStatsEvent([], now)).toBeNull();
  });
});

// Quick-add's starting event (z8uq9m0hw3, item 1). Input is newest-first, the
// order usePoEvents returns.
describe('defaultAddGuestEvent', () => {
  const nextWeek = { id: 'next-week', when: 'upcoming' as const };
  const tonight = { id: 'tonight', when: 'upcoming' as const }; // live or later today
  const lastWeek = { id: 'last-week', when: 'past' as const };
  const lastMonth = { id: 'last-month', when: 'past' as const };

  it('never falls back to a past event: nothing upcoming → undefined', () => {
    expect(defaultAddGuestEvent([lastWeek, lastMonth])).toBeUndefined();
    expect(defaultAddGuestEvent([])).toBeUndefined();
  });

  it('picks the soonest upcoming event, not the furthest one', () => {
    expect(defaultAddGuestEvent([nextWeek, tonight, lastWeek])?.id).toBe('tonight');
    expect(defaultAddGuestEvent([nextWeek, lastWeek])?.id).toBe('next-week');
  });

  it('honours an explicitly requested event, past or not', () => {
    expect(defaultAddGuestEvent([nextWeek, tonight, lastWeek], 'next-week')?.id).toBe('next-week');
    expect(defaultAddGuestEvent([nextWeek, tonight, lastWeek], 'last-week')?.id).toBe('last-week');
  });

  it('ignores an unknown requested id and uses the default', () => {
    expect(defaultAddGuestEvent([nextWeek, tonight, lastWeek], 'gone')?.id).toBe('tonight');
    expect(defaultAddGuestEvent([lastWeek], 'gone')).toBeUndefined();
  });
});
