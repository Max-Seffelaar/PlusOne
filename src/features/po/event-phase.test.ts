import { describe, expect, it } from 'vitest';
import { defaultAddGuestEvent, eventPhase, eventWhenFromPhase, LIVE_GRACE_MS } from './event-phase';

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
