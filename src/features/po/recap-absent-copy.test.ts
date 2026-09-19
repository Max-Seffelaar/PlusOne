/**
 * The recap (/app/events/{id}/recap) names guests on the list who aren't inside
 * by the event's phase (z8uq9m0hw4, Max's rule): nothing before the event,
 * "On the way" while it runs, "No-shows" only after it has ended. The recap is
 * only linked for past events, but a direct URL to a live event's recap must
 * never say "no-show" mid-event.
 */
import { describe, expect, it } from 'vitest';
import { fmt } from '@/lib/i18n';
import { eventPhase } from './event-phase';
import { recapAbsentCopy } from './format';

const START = '2026-09-18T21:00:00Z';
const END = '2026-09-19T03:00:00Z';

describe('recapAbsentCopy', () => {
  it('shows no figure and no list before the event', () => {
    expect(recapAbsentCopy('upcoming')).toBeNull();
  });

  it('calls them "On the way" while the event runs, and never no-shows', () => {
    const c = recapAbsentCopy('live');
    expect(c).not.toBeNull();
    expect(c?.tile).toBe('On the way');
    expect(fmt(c?.heading ?? '', { n: 16 })).toBe('On the way · 16');
    expect(c?.tag).toBe('on the way');
    expect(fmt(c?.showAll ?? '', { n: 16 })).toBe('Show all 16 on the way');
    expect(c?.empty).toBe("Everyone's in.");
    expect(Object.values(c ?? {}).join(' ')).not.toMatch(/no-show/i);
  });

  it('only says "No-shows" once the event has ended', () => {
    const c = recapAbsentCopy('past');
    expect(c?.tile).toBe('No-shows');
    expect(fmt(c?.heading ?? '', { n: 3 })).toBe('No-shows · 3');
    expect(c?.tag).toBe('no-show');
    expect(fmt(c?.showAll ?? '', { n: 3 })).toBe('Show all 3 no-shows');
  });

  it('follows the clock across the night for a direct recap URL', () => {
    const at = (iso: string): string | null => recapAbsentCopy(eventPhase(START, END, Date.parse(iso)))?.tile ?? null;
    expect(at('2026-09-18T20:59:00Z')).toBeNull();
    expect(at('2026-09-18T23:30:00Z')).toBe('On the way');
    expect(at('2026-09-19T03:00:00Z')).toBe('On the way');
    expect(at('2026-09-19T03:01:00Z')).toBe('No-shows');
  });
});
