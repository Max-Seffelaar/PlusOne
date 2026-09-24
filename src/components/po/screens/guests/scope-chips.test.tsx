// @vitest-environment jsdom
/**
 * `GuestScopeChips` — the Guests-tab scope row (ADE round, item H).
 *
 * The screenshot that triggered this had seven chips in one row with past
 * events shuffled in among the upcoming ones, so "which list am I looking at"
 * took a scroll to answer. The split has three properties worth pinning, all of
 * which are easy to regress silently:
 *
 * - ORDER. The read hands events over newest-first (`starts_at desc`), which is
 *   right for past events and backwards for upcoming ones — you want what's next
 *   first. A refactor that drops the reverse looks fine on a venue with two
 *   events and is wrong on every real one.
 * - THE CAP. A venue two years in has hundreds of past events. Without the cap
 *   the Regulars filter ends up a screen and a half to the right.
 * - SELF-HIDING. Picking a past chip must not collapse the group the chip lives
 *   in, or the selected scope disappears the moment you select it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { PoEvent } from '@/lib/po/types';
import { t } from '@/lib/i18n';
import { GuestScopeChips } from './list-shared';

function ev(name: string, when: PoEvent['when']): PoEvent {
  return {
    id: name,
    name,
    venue: 'Club',
    time: '23:00',
    date: '14',
    mon: 'DEC',
    month: 'December 2026',
    guests: 0,
    inside: 0,
    when,
    phase: when === 'upcoming' ? 'upcoming' : 'past',
    cancelled: false,
  };
}

/** Newest-first, exactly as `fetchEvents` returns them (`starts_at desc`). */
const EVENTS: PoEvent[] = [
  ev('Later', 'upcoming'),
  ev('Soon', 'upcoming'),
  ev('Yesterday', 'past'),
  ev('Last week', 'past'),
];

function paint(events: PoEvent[] = EVENTS, scope: string | null = null) {
  const onScope = vi.fn();
  const utils = render(
    <GuestScopeChips
      events={events}
      scope={scope}
      onScope={onScope}
      regularsOnly={false}
      onToggleRegulars={vi.fn()}
    />,
  );
  return { onScope, ...utils };
}

/** The chip labels, in DOM order. */
function chipOrder(container: HTMLElement): string[] {
  return within(container)
    .getAllByRole('button')
    .map((b) => b.textContent?.trim() ?? '');
}

describe('GuestScopeChips', () => {
  it('shows All events, then the upcoming events SOONEST first, then Past, then Regulars', () => {
    const { container } = paint();
    expect(chipOrder(container)).toEqual([
      t.guests.list.allScope,
      'Soon',
      'Later',
      t.guests.list.pastScope,
      t.guests.list.regularsFilter,
    ]);
  });

  it('keeps past events out of the row until you ask for them', () => {
    paint();
    expect(screen.queryByRole('button', { name: 'Yesterday' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.list.pastScope) }));
    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeTruthy();
  });

  it('lists the revealed past events MOST RECENT first', () => {
    const { container } = paint();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.list.pastScope) }));
    const order = chipOrder(container);
    expect(order.indexOf('Yesterday')).toBeLessThan(order.indexOf('Last week'));
  });

  it('collapses again on a second tap', () => {
    paint();
    const toggle = screen.getByRole('button', { name: new RegExp(t.guests.list.pastScope) });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByRole('button', { name: 'Yesterday' })).toBeNull();
  });

  it('leaves the group OPEN when a past event is picked, so the chip does not hide itself', () => {
    const { onScope } = paint();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(t.guests.list.pastScope) }));
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    expect(onScope).toHaveBeenCalledWith('Yesterday');
    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeTruthy();
  });

  it('caps the past chips and offers "Show all" for the rest', () => {
    const many = [
      ev('Next up', 'upcoming'),
      ...Array.from({ length: 20 }, (_, i) => ev(`Past ${i}`, 'past')),
    ];
    paint(many);
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${t.guests.list.pastScope}`) }));
    expect(screen.getByRole('button', { name: 'Past 11' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Past 12' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: t.guests.list.pastShowAll }));
    expect(screen.getByRole('button', { name: 'Past 19' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.guests.list.pastShowAll })).toBeNull();
  });

  it('hides the Past toggle entirely for a venue with no history yet', () => {
    paint([ev('Soon', 'upcoming')]);
    expect(screen.queryByRole('button', { name: new RegExp(t.guests.list.pastScope) })).toBeNull();
    expect(screen.getByRole('button', { name: t.guests.list.regularsFilter })).toBeTruthy();
  });

  it('marks the active scope and reports "All events" as null, not an id', () => {
    const { onScope } = paint(EVENTS, 'Soon');
    expect(screen.getByRole('button', { name: 'Soon' }).className).toContain('bg-text');
    fireEvent.click(screen.getByRole('button', { name: t.guests.list.allScope }));
    expect(onScope).toHaveBeenCalledWith(null);
  });

  it('keeps the Regulars filter last and toggles it', () => {
    const onToggleRegulars = vi.fn();
    const { container } = render(
      <GuestScopeChips
        events={EVENTS}
        scope={null}
        onScope={vi.fn()}
        regularsOnly
        onToggleRegulars={onToggleRegulars}
      />,
    );
    const order = chipOrder(container);
    expect(order[order.length - 1]).toBe(t.guests.list.regularsFilter);
    const regulars = screen.getByRole('button', { name: t.guests.list.regularsFilter });
    expect(regulars.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(regulars);
    expect(onToggleRegulars).toHaveBeenCalled();
  });
});
