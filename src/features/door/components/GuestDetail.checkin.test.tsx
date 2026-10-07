// @vitest-environment jsdom
/**
 * Group-first check-in on the phone door (z8uq9m2vg6). No "how many?" stepper:
 * "Check in all (N)" checks in everyone still outside, "Check in 1" lets one
 * more person in and shows the running count (3/4). The undo button follows
 * the database's answer for this user (canUncheck), not just the setting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import type { DoorGuest } from '../model';

const door = vi.hoisted(() => ({
  checkIn: vi.fn(),
  checkInOne: vi.fn(),
  reviveCheckIn: vi.fn(),
  voidCheckIn: vi.fn(),
  canUncheck: true,
}));

function base(over: Partial<DoorGuest> = {}): DoorGuest {
  return {
    id: 'g1',
    name: 'Juri Braakman',
    plus: 3,
    tierId: 't1',
    tierName: 'Regular',
    tierColor: '#8E8E93',
    checkInId: null,
    tierIcon: 'user',
    addedByName: 'Manager',
    addedAt: '1 jan',
    last4: null,
    note: null,
    notePriority: 'none',
    acknowledged: false,
    inside: false,
    voided: false,
    pay: false,
    arrived: undefined,
    refused: false,
    refusedReason: undefined,
    ...over,
  };
}
const guest: { current: DoorGuest } = { current: base() };

vi.mock('../DoorProvider', () => ({
  useDoor: () => ({
    eventId: 'e1',
    guestById: (id: string) => (id === guest.current.id ? guest.current : undefined),
    checkIn: door.checkIn,
    checkInOne: door.checkInOne,
    topUp: vi.fn(),
    voidCheckIn: door.voidCheckIn,
    reviveCheckIn: door.reviveCheckIn,
    refuse: vi.fn(),
    ackNote: vi.fn(),
    allowUncheck: true,
    canUncheck: door.canUncheck,
  }),
  useDoorSyncStatus: () => ({ online: true }),
}));
vi.mock('@/components/po/screens/guests/profile-sheets', () => ({ PlusOnesSheet: () => null }));

import { GuestDetail } from './GuestDetail';

beforeEach(() => {
  door.checkIn.mockReset();
  door.checkInOne.mockReset();
  door.reviveCheckIn.mockReset();
  door.voidCheckIn.mockReset();
  door.canUncheck = true;
});

describe('GuestDetail — group-first check-in', () => {
  it('offers "Check in all (4)" for a party of four, and no "how many?" question', () => {
    guest.current = base();
    const onBack = vi.fn();
    render(<GuestDetail guestId="g1" onBack={onBack} />);
    fireEvent.click(screen.getByRole('button', { name: /Check in all \(4\)/ }));
    expect(door.checkIn).toHaveBeenCalledWith('g1', 4);
    expect(onBack).toHaveBeenCalled();
    expect(screen.queryByText(/How many/i)).toBeNull();
  });

  it('"Check in 1" shows the count, lets one in, and stays on the guest', () => {
    guest.current = base();
    const onBack = vi.fn();
    render(<GuestDetail guestId="g1" onBack={onBack} />);
    const one = screen.getByRole('button', { name: /Check in 1/ });
    expect(one).toHaveTextContent('0/4');
    fireEvent.click(one);
    expect(door.checkInOne).toHaveBeenCalledWith('g1');
    expect(onBack).not.toHaveBeenCalled();
  });

  it('part of the party inside: "Check in all" covers the rest and the count reads 3/4', () => {
    guest.current = base({ inside: true, arrived: 2, checkInId: 'ci1', inAt: '22:01', inByName: 'Lisa' });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Check in all \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Check in 1/ })).toHaveTextContent('3/4');
    fireEvent.click(screen.getByRole('button', { name: /Check in all \(1\)/ }));
    expect(door.checkIn).toHaveBeenCalledWith('g1', 4);
  });

  it('a solo guest gets one plain "Check in"', () => {
    guest.current = base({ plus: 0 });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: t.door.checkIn })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Check in 1/ })).toBeNull();
  });

  it('a reversed check-in comes back through the revive path', () => {
    guest.current = base({ voided: true, checkInId: 'ci1' });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Check in all \(4\)/ }));
    expect(door.reviveCheckIn).toHaveBeenCalledWith('g1', 4);
    expect(door.checkIn).not.toHaveBeenCalled();
  });

  it('everyone inside: no check-in buttons, just the status', () => {
    guest.current = base({ inside: true, arrived: 3, checkInId: 'ci1', inAt: '22:01', inByName: 'Lisa' });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Check in all/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Check in 1/ })).toBeNull();
  });
});

describe('GuestDetail — undo follows the user\'s right, not just the setting', () => {
  it('shows "Reverse check-in" when this user may undo', () => {
    guest.current = base({ inside: true, arrived: 3, checkInId: 'ci1' });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: t.door.uncheckBtn }));
    expect(door.voidCheckIn).toHaveBeenCalledWith('g1');
  });

  it('hides it and says who can, when this user may not', () => {
    door.canUncheck = false;
    guest.current = base({ inside: true, arrived: 3, checkInId: 'ci1' });
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
    expect(screen.queryByRole('button', { name: t.door.uncheckBtn })).toBeNull();
    expect(screen.getByText(t.door.uncheckDisabled)).toBeInTheDocument();
  });
});
