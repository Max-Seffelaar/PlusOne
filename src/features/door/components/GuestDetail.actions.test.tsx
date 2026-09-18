// @vitest-environment jsdom
/**
 * Item M2 (ADE UX round 17/9): "Edit plus-ones" in the door overlay's "…" sheet
 * is ONLINE-ONLY and must say so.
 *
 * Why this deserves a test of its own: the door's whole contract is that what a
 * doorhost taps survives a dead connection, because it goes through the offline
 * outbox. Editing +N does NOT — the outbox has three op kinds (check_in,
 * refusal, add_guest) and this round deliberately did not add a fourth (#25).
 * So the one thing that must never regress is that the action is unreachable
 * while offline instead of silently queueing a write the door cannot replay.
 *
 * `PlusOnesSheet` is the guest-profile sheet stream S4 owns; it is mocked here
 * so this file tests the door's gate, not that sheet's internals.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { t } from '@/lib/i18n';
import type { DoorGuest } from '../model';

const online = { current: true };
const guest: { current: DoorGuest } = {
  current: {
    id: 'g1',
    name: 'Juri Braakman',
    plus: 2,
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
  },
};

vi.mock('../DoorProvider', () => ({
  useDoor: () => ({
    eventId: 'e1',
    guestById: (id: string) => (id === guest.current.id ? guest.current : undefined),
    checkIn: vi.fn(),
    topUp: vi.fn(),
    voidCheckIn: vi.fn(),
    reviveCheckIn: vi.fn(),
    refuse: vi.fn(),
    ackNote: vi.fn(),
    allowUncheck: true,
  }),
  useDoorSyncStatus: () => ({ online: online.current }),
}));

// The +N editor itself belongs to the guests profile (stream S4). Replaced with
// a marker so this file asserts the door's wiring and its offline gate only.
vi.mock('@/components/po/screens/guests/profile-sheets', () => ({
  PlusOnesSheet: ({ guestId, eventId, plusOnes }: { guestId: string; eventId: string; plusOnes: number }) => (
    <div data-testid="plus-ones-sheet" data-guest={guestId} data-event={eventId} data-plus={plusOnes} />
  ),
}));

// Imported AFTER the mocks so the component picks them up.
import { GuestDetail } from './GuestDetail';

function open(): void {
  render(<GuestDetail guestId="g1" onBack={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: t.door.actionsAria }));
}

describe('GuestDetail · the "…" actions sheet (item M2)', () => {
  it('online: "Edit plus-ones" is enabled and opens the shared +N sheet for this guest', () => {
    online.current = true;
    open();

    const action = screen.getByRole('button', { name: new RegExp(t.door.actionEditPlusOnes) });
    expect(action).toBeEnabled();
    expect(screen.queryByText(t.door.actionOfflineHint)).toBeNull();

    fireEvent.click(action);
    const sheet = screen.getByTestId('plus-ones-sheet');
    expect(sheet).toHaveAttribute('data-guest', 'g1');
    expect(sheet).toHaveAttribute('data-event', 'e1');
    expect(sheet).toHaveAttribute('data-plus', '2');
  });

  it('offline: the action is disabled, says it needs a connection, and opens nothing', () => {
    online.current = false;
    open();

    const action = screen.getByRole('button', { name: new RegExp(t.door.actionEditPlusOnes) });
    expect(action).toBeDisabled();
    expect(screen.getByText(t.door.actionNeedsConnection)).toBeInTheDocument();
    expect(screen.getByText(t.door.actionOfflineHint)).toBeInTheDocument();

    fireEvent.click(action);
    expect(screen.queryByTestId('plus-ones-sheet')).toBeNull();
  });

  it('offline: check-in itself is untouched — it still goes through the outbox', () => {
    online.current = false;
    render(<GuestDetail guestId="g1" onBack={vi.fn()} />);

    // The bottom-bar confirm button is the outbox path and must never be gated
    // on connectivity (#25).
    expect(screen.getByRole('button', { name: /Check in · 1 person/ })).toBeEnabled();
  });
});
