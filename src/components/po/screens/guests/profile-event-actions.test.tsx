// @vitest-environment jsdom
/**
 * `EventRowActions`: the "…" sheet on each event card of the person profile
 * (z8uq9m0hw5). The permission MATH is pinned in permissions.test.ts; this pins
 * the wiring around it:
 *
 * 1. The sheet shows exactly the actions `profileRowActions` allows for the
 *    viewer (admin: all four; staff on someone else's guest: only "Open event";
 *    staff on a locked list: a lock note instead of the writes).
 * 2. "Change tier" needs a real choice (more than one tier) and holds its place
 *    while the tiers load, so "Remove" doesn't jump under a finger.
 * 3. Remove is a confirmed soft delete via usePoRemoveGuest(guestId), its copy
 *    says what happens to the slots (#22: freed, unless the guest is inside), and
 *    a database refusal is shown verbatim, never swallowed.
 * 4. "Open event" lands on the recap for a past event.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';
import type { PoProfileEvent } from '@/features/po/adapters';
import type { VenueRole } from '@/features/auth/roles';

const H = vi.hoisted(() => ({
  roles: ['admin'] as string[],
  tiers: [] as { id: string; name: string; color: string }[],
  tiersLoading: false,
  removeMutate: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/features/po/hooks', () => ({
  usePoTiers: () => ({ data: H.tiers, isLoading: H.tiersLoading }),
}));
vi.mock('@/features/po/mutations', () => ({
  usePoChangeGuestTier: () => ({ mutate: vi.fn(), isPending: false }),
  usePoRemoveGuest: () => ({ mutate: H.removeMutate, isPending: false }),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'v1', userId: 'u-me', roles: H.roles }),
}));
vi.mock('../../context', () => ({
  useNav: () => ({ push: H.push, back: vi.fn() }),
}));
// The +N sheet has its own suite (plus-ones-sheet.test.tsx); stub it here.
vi.mock('./profile-sheets', () => ({
  PlusOnesSheet: () => <div>plus-ones-sheet</div>,
}));

const { EventRowActions } = await import('./profile-event-actions');

const cp = t.guests.contactProfile;
const TWO_TIERS = [
  { id: 't1', name: 'Guest', color: '#B5A6FF' },
  { id: 't2', name: 'VIP', color: '#9DE0C0' },
];

function event(over: Partial<PoProfileEvent> = {}): PoProfileEvent {
  return {
    eventId: 'e1',
    guestId: 'g1',
    name: 'FRENZY',
    dateLabel: 'Fri 18 Sept 2026',
    tier: 'VIP',
    tierColor: '#9DE0C0',
    role: 'VIP',
    status: 'onTheWay',
    plusOnes: 2,
    presentHeads: null,
    registeredHeads: 3,
    note: null,
    noteFlag: null,
    isOrigin: true,
    startsAt: '2026-09-18T21:00:00Z',
    phase: 'upcoming',
    tierId: 't2',
    addedById: 'u-other',
    listLocked: false,
    autoLockAt: null,
    cancelled: false,
    anonymized: false,
    source: 'app',
    addedByName: 'Max',
    linkLabel: null,
    ...over,
  };
}

function open(e: PoProfileEvent = event(), onDone = vi.fn()): { onDone: ReturnType<typeof vi.fn> } {
  render(<EventRowActions event={e} guestName="Lotte Jansen" isOrganizer={false} onClose={vi.fn()} onDone={onDone} />);
  return { onDone };
}

const item = (name: string): HTMLElement | null => screen.queryByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  H.roles = ['admin'] as VenueRole[];
  H.tiers = TWO_TIERS;
  H.tiersLoading = false;
  H.removeMutate.mockReset();
  H.push.mockReset();
});

describe('EventRowActions: which actions show', () => {
  it('admin gets open, +N, tier and remove', () => {
    open();
    expect(item(cp.openEvent)).toBeTruthy();
    expect(item(fmt(t.guests.plusOnes.edit, { n: 2 }).replace('+', '\\+'))).toBeTruthy();
    expect(item(cp.changeTier)).toBeTruthy();
    expect(item(cp.removeFromList)).toBeTruthy();
  });

  it('staff looking at a colleague\'s guest may only open the event', () => {
    H.roles = ['staff'];
    open();
    expect(item(cp.openEvent)).toBeTruthy();
    expect(item(cp.changeTier)).toBeNull();
    expect(item(cp.removeFromList)).toBeNull();
    expect(screen.queryByText(cp.lockedNote)).toBeNull();
  });

  it('staff on a locked list sees why their own guest is read-only (#23)', () => {
    H.roles = ['staff'];
    open(event({ addedById: 'u-me', listLocked: true }));
    expect(screen.getByText(cp.lockedNote)).toBeTruthy();
    expect(item(cp.removeFromList)).toBeNull();
  });

  it('offers "Add plus-ones" when the guest has none yet', () => {
    open(event({ plusOnes: 0, registeredHeads: 1 }));
    expect(item(t.guests.plusOnes.add)).toBeTruthy();
  });

  it('hides the tier change when the event has a single tier', () => {
    H.tiers = [TWO_TIERS[0]];
    open();
    expect(item(cp.changeTier)).toBeNull();
    expect(item(cp.removeFromList)).toBeTruthy();
  });

  it('holds the tier row (disabled) while the tiers load', () => {
    H.tiers = [];
    H.tiersLoading = true;
    open();
    const row = item(cp.changeTier);
    expect(row?.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(cp.tiersLoading)).toBeTruthy();
  });
});

describe('EventRowActions: open event', () => {
  it('opens the live/upcoming event screen', () => {
    open();
    fireEvent.click(item(cp.openEvent)!);
    expect(H.push).toHaveBeenCalledWith('event', { id: 'e1' });
  });

  it('opens the recap for a past event', () => {
    open(event({ phase: 'past' }));
    fireEvent.click(item(cp.openEvent)!);
    expect(H.push).toHaveBeenCalledWith('pastevent', { id: 'e1' });
  });
});

describe('EventRowActions: remove', () => {
  it('confirms first, saying the slots free up (1 + N)', () => {
    open();
    fireEvent.click(item(cp.removeFromList)!);
    expect(screen.getByText(fmt(cp.removeTitle, { event: 'FRENZY' }))).toBeTruthy();
    expect(
      screen.getByText(fmt(cp.removeBody, { name: 'Lotte Jansen', n: 3, slots: t.guests.plusOnes.slotMany })),
    ).toBeTruthy();
    expect(H.removeMutate).not.toHaveBeenCalled();
  });

  it('says a guest who is inside keeps counting (#22)', () => {
    open(event({ status: 'inside', presentHeads: 2, plusOnes: 0, registeredHeads: 1 }));
    fireEvent.click(item(cp.removeFromList)!);
    expect(
      screen.getByText(fmt(cp.removeBodyInside, { name: 'Lotte Jansen', n: 1, slots: t.guests.plusOnes.slotOne })),
    ).toBeTruthy();
  });

  it('soft-deletes that guest row and reports the row as removed', () => {
    H.removeMutate.mockImplementation((_id: string, opts: { onSuccess: () => void }) => opts.onSuccess());
    const { onDone } = open();
    fireEvent.click(item(cp.removeFromList)!);
    fireEvent.click(screen.getByRole('button', { name: cp.removeConfirm }));
    expect(H.removeMutate).toHaveBeenCalledWith('g1', expect.any(Object));
    expect(onDone).toHaveBeenCalledWith({ toast: fmt(cp.removed, { event: 'FRENZY' }), removed: true });
  });

  it('shows a database refusal verbatim and stays open', async () => {
    H.removeMutate.mockImplementation((_id: string, opts: { onError: (e: Error) => void }) =>
      opts.onError(new Error("Couldn't save this change (no access, or it no longer exists).")),
    );
    const { onDone } = open();
    fireEvent.click(item(cp.removeFromList)!);
    fireEvent.click(screen.getByRole('button', { name: cp.removeConfirm }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe("Couldn't save this change (no access, or it no longer exists)."),
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});
