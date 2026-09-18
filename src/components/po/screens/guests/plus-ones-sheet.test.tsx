// @vitest-environment jsdom
/**
 * `PlusOnesSheet` — editing +N from the person profile (ADE round, item M1).
 *
 * Two things carry real risk here, so they're what these tests pin:
 *
 * 1. The SLOT MATH (#5: a guest with +N eats 1 + N slots). The sheet shows the
 *    cost before you commit, and the quota hint has to move by the DELTA against
 *    what the guest already holds — a guest already on the list with +2 who goes
 *    to +3 costs the caller ONE more slot, not four. Getting that wrong would
 *    show "quota full" on a save the database would happily accept.
 * 2. The mutation is called with the new TOTAL (`plusOnes`), never a delta —
 *    `updateGuest` sets the column. An off-by-one here silently halves or
 *    doubles every party at the door.
 *
 * The quota line is a HINT: the database still owns quota (#22) and the list
 * lock (#23), so an over-quota preview must not disable the save. That's the
 * third assertion — it's the difference between "the server refused" and "the
 * UI decided for itself with stale numbers".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { t, fmt } from '@/lib/i18n';

const H = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  quota: { quota: 10, consumed: 2, remaining: 3, exempt: false } as {
    quota: number;
    consumed: number;
    remaining: number | null;
    exempt: boolean;
  } | null,
}));

vi.mock('@/features/po/hooks', () => ({
  usePoQuota: () => ({ data: H.quota }),
  usePoEvents: () => ({ data: [] }),
  usePoTiers: () => ({ data: [] }),
  usePoGuests: () => ({ data: [] }),
}));
vi.mock('@/features/po/mutations', () => {
  const stub = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false });
  return {
    usePoUpdateGuest: () => ({ mutateAsync: H.mutateAsync, mutate: vi.fn(), isPending: false }),
    usePoToggleContactPermanent: stub,
    usePoAddContactToEvent: stub,
    usePoUpsertContact: stub,
    usePoForgetContact: stub,
    usePoChangeGuestTier: stub,
    usePoPromoteGuestToContact: stub,
  };
});
vi.mock('@/features/po/PoLiveProvider', () => ({
  usePoIdentity: () => ({ venueId: 'v1', roles: ['admin'] }),
}));
vi.mock('../../phone-lazy', () => ({
  CountrySelect: () => null,
  PhoneInput: () => null,
  isPhoneValid: async () => true,
  useStoredPhoneCountry: () => ['NL', vi.fn()],
}));

const { PlusOnesSheet, MAX_PROFILE_PLUS_ONES } = await import('./profile-sheets');

const po = t.guests.plusOnes;

function open(current = 0): { onSaved: ReturnType<typeof vi.fn> } {
  const onSaved = vi.fn();
  render(
    <PlusOnesSheet
      guestId="g1"
      eventId="e1"
      name="Noor de Wit"
      current={current}
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

const more = (): HTMLElement => screen.getByLabelText(t.shared.kit.stepperMore);
const less = (): HTMLElement => screen.getByLabelText(t.shared.kit.stepperLess);
const slots = (n: number): string => fmt(po.slotsLine, { total: n, slots: n === 1 ? po.slotOne : po.slotMany });

beforeEach(() => {
  H.mutateAsync.mockReset().mockResolvedValue(undefined);
  H.quota = { quota: 10, consumed: 2, remaining: 3, exempt: false };
});

describe('PlusOnesSheet slot math', () => {
  it('starts at the guest\'s current +N and shows 1 + N slots', () => {
    open(2);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText(new RegExp(slots(3)))).toBeTruthy();
  });

  it('a guest with no plus-ones still costs one slot', () => {
    open(0);
    expect(screen.getByText(new RegExp(slots(1)))).toBeTruthy();
  });

  it('recomputes the cost as the stepper moves', () => {
    open(0);
    fireEvent.click(more());
    fireEvent.click(more());
    expect(screen.getByText(new RegExp(slots(3)))).toBeTruthy();
  });

  it('charges the quota only the DELTA against what the guest already holds', () => {
    // 3 slots left, guest already at +2 (3 slots). Going to +3 costs ONE more.
    open(2);
    fireEvent.click(more());
    expect(screen.getByText(new RegExp(fmt(po.quotaLeft, { n: 2 })))).toBeTruthy();
  });

  it('frees slots back when the plus-ones go down', () => {
    open(2);
    fireEvent.click(less());
    fireEvent.click(less());
    expect(screen.getByText(new RegExp(fmt(po.quotaLeft, { n: 5 })))).toBeTruthy();
  });

  it('flags going over quota, but never disables the save (the DB decides)', () => {
    open(0);
    for (let i = 0; i < 5; i += 1) fireEvent.click(more()); // +5 = 6 slots, 1 held, 3 left
    expect(screen.getByText(new RegExp(fmt(po.quotaOver, { n: 2 })))).toBeTruthy();
    expect(screen.getByRole('button', { name: fmt(po.save, { n: 5 }) }).hasAttribute('disabled')).toBe(false);
  });

  it('says "no limit" for an exempt role instead of a slot countdown', () => {
    H.quota = { quota: -1, consumed: 0, remaining: null, exempt: true };
    open(1);
    expect(screen.getByText(new RegExp(po.quotaExempt))).toBeTruthy();
  });

  it('clamps at the sheet ceiling and explains the way out', () => {
    open(0);
    for (let i = 0; i < MAX_PROFILE_PLUS_ONES + 4; i += 1) fireEvent.click(more());
    expect(screen.getByText(String(MAX_PROFILE_PLUS_ONES))).toBeTruthy();
    expect(screen.getByText(fmt(po.max, { n: MAX_PROFILE_PLUS_ONES }))).toBeTruthy();
  });

  it('never steps below zero', () => {
    open(0);
    fireEvent.click(less());
    fireEvent.click(less());
    expect(screen.getByText('0')).toBeTruthy();
  });
});

describe('PlusOnesSheet mutation', () => {
  it('calls updateGuest with the new TOTAL, not a delta', async () => {
    const { onSaved } = open(2);
    fireEvent.click(more());
    fireEvent.click(screen.getByRole('button', { name: fmt(po.save, { n: 3 }) }));
    await waitFor(() => expect(H.mutateAsync).toHaveBeenCalledWith({ guestId: 'g1', plusOnes: 3 }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('saves a drop to zero (removing every plus-one is a real edit)', async () => {
    open(2);
    fireEvent.click(less());
    fireEvent.click(less());
    fireEvent.click(screen.getByRole('button', { name: fmt(po.save, { n: 0 }) }));
    await waitFor(() => expect(H.mutateAsync).toHaveBeenCalledWith({ guestId: 'g1', plusOnes: 0 }));
  });

  it('surfaces a server refusal (quota / list lock) instead of swallowing it', async () => {
    H.mutateAsync.mockRejectedValue(new Error('This list is locked.'));
    const { onSaved } = open(0);
    fireEvent.click(screen.getByRole('button', { name: fmt(po.save, { n: 0 }) }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('This list is locked.'));
    expect(onSaved).not.toHaveBeenCalled();
  });
});
