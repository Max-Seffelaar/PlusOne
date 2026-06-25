import { describe, expect, it } from 'vitest';
import { eventPhase, eventWhenFromPhase, LIVE_GRACE_MS } from './event-phase';

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
