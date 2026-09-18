// @vitest-environment jsdom
/**
 * Item O (ADE UX round 17/9): a fully-inside party must NOT offer a pressable ✓.
 *
 * The old row rendered `ChkBtn kind="in" active` for everyone who was inside, so
 * the one affordance a host could reach for on a complete party did nothing but
 * toast "already fully inside". A party that is only PARTLY inside keeps the
 * button — that is the top-up entry, and it now says so in its tooltip.
 *
 * Rendered directly rather than through the cockpit's virtualizer: jsdom gives a
 * scroll container zero height, so @tanstack/react-virtual would window every
 * row away and the assertions below would pass for the wrong reason.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t, fmt } from '@/lib/i18n';
import type { Guest } from '@/lib/po/types';
import { CockpitGuestRow } from './CockpitGuestRow';

function guest(over: Partial<Guest> = {}): Guest {
  return {
    id: 'g1',
    name: 'Juri Braakman',
    role: 'Guest',
    tierId: 't1',
    tierName: 'Regular',
    tierColor: '#8E8E93',
    pay: 'free',
    plus: 2,
    note: '',
    flag: null,
    by: 'Manager',
    addedAt: '1 jan',
    status: 'in',
    ...over,
  };
}

function row(g: Guest, arrival?: { arrived: number; at: string }) {
  return render(
    <CockpitGuestRow
      g={g}
      tierColor="#8E8E93"
      tierName="Regular"
      arrival={arrival}
      flash={false}
      canCheckIn
      allowUncheck
      onCheckInClick={vi.fn()}
      onVoid={vi.fn()}
      onRefuseClick={vi.fn()}
      onUndoRefuse={vi.fn()}
    />,
  );
}

describe('CockpitGuestRow · the check-in slot (item O)', () => {
  it('a fully-inside party gets the static badge and no check-in button', () => {
    row(guest({ plus: 2 }), { arrived: 2, at: '2026-09-17T23:07:00.000Z' });

    expect(screen.queryByTitle(t.cockpit.checkInTitle)).toBeNull();
    // Not a button at all: nothing to press, nothing to no-op on.
    const badge = screen.getByRole('img', { name: /^Inside/ });
    expect(badge).toBeInTheDocument();
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('cursor-default');
  });

  it('a +0 guest who is inside is fully inside too, so also a badge', () => {
    row(guest({ plus: 0 }), { arrived: 0, at: '2026-09-17T23:07:00.000Z' });

    expect(screen.queryByTitle(t.cockpit.checkInTitle)).toBeNull();
    expect(screen.getByRole('img', { name: /^Inside/ })).toBeInTheDocument();
  });

  it('the badge names the arrival time so a host can read it back', () => {
    row(guest(), { arrived: 2, at: '2026-09-17T23:07:00.000Z' });

    const label = screen.getByRole('img', { name: /^Inside since / }).getAttribute('aria-label');
    expect(label).toMatch(/^Inside since .+/);
  });

  it('a partly-inside party keeps the ✓ as the top-up button, with the count in its title', () => {
    row(guest({ plus: 2 }), { arrived: 1, at: '2026-09-17T23:07:00.000Z' });

    const topUp = screen.getByTitle(fmt(t.cockpit.checkInTopUpTitle, { arrived: 2, total: 3 }));
    expect(topUp.tagName).toBe('BUTTON');
    expect(screen.queryByRole('img', { name: /^Inside/ })).toBeNull();
  });

  it('a guest on the way keeps the plain "Check in" button', () => {
    row(guest({ status: 'wait', plus: 2 }));

    expect(screen.getByTitle(t.cockpit.checkInTitle).tagName).toBe('BUTTON');
    expect(screen.queryByRole('img', { name: /^Inside/ })).toBeNull();
  });

  it('a role without check-in rights gets neither button nor badge', () => {
    render(
      <CockpitGuestRow
        g={guest()}
        tierColor="#8E8E93"
        tierName="Regular"
        arrival={{ arrived: 2, at: '2026-09-17T23:07:00.000Z' }}
        flash={false}
        canCheckIn={false}
        allowUncheck
        onCheckInClick={vi.fn()}
        onVoid={vi.fn()}
        onRefuseClick={vi.fn()}
        onUndoRefuse={vi.fn()}
      />,
    );

    expect(screen.queryByTitle(t.cockpit.checkInTitle)).toBeNull();
    expect(screen.queryByRole('img', { name: /^Inside/ })).toBeNull();
  });
});
