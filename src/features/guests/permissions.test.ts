/**
 * The guest write permissions the person profile gates its row actions on
 * (z8uq9m0hw5). These mirror SQL, so the cases below are the SQL's branches:
 *
 * - `can_write_guests` (20260624200000): admin always; nobody else on a cancelled
 *   event; organizer + doorhost ignore the lock; staff only on an open list.
 * - `guests_update` (20260613120000 / 20260811160000): not anonymized, may write
 *   the event, AND own row or admin/doorhost/organizer.
 *
 * If one of these fails after a migration, the migration changed the rule: fix
 * the mirror to match the database, never the other way round.
 */
import { describe, it, expect } from 'vitest';
import type { VenueRole } from '@/features/auth/roles';
import {
  canUpdateGuest,
  canWriteGuests,
  isListLocked,
  profileRowActions,
  type GuestWriteEvent,
  type GuestWriteRow,
  type GuestWriteViewer,
} from './permissions';

const NOW = Date.parse('2026-09-18T20:00:00Z');
const OPEN: GuestWriteEvent = { cancelled: false, listLocked: false, autoLockAt: null };
const LOCKED: GuestWriteEvent = { ...OPEN, listLocked: true };
const AUTO_LOCKED: GuestWriteEvent = { ...OPEN, autoLockAt: '2026-09-18T19:00:00Z' };
const AUTO_LOCK_LATER: GuestWriteEvent = { ...OPEN, autoLockAt: '2026-09-18T23:00:00Z' };
const CANCELLED: GuestWriteEvent = { ...OPEN, cancelled: true };

const ME = 'u-me';
const viewer = (roles: VenueRole[], isOrganizer = false): GuestWriteViewer => ({ roles, userId: ME, isOrganizer });
const MINE: GuestWriteRow = { addedBy: ME, anonymized: false };
const THEIRS: GuestWriteRow = { addedBy: 'u-other', anonymized: false };
const VIA_LINK: GuestWriteRow = { addedBy: null, anonymized: false };

describe('isListLocked', () => {
  it('is the manual lock OR a passed auto-lock', () => {
    expect(isListLocked(OPEN, NOW)).toBe(false);
    expect(isListLocked(LOCKED, NOW)).toBe(true);
    expect(isListLocked(AUTO_LOCKED, NOW)).toBe(true);
    expect(isListLocked(AUTO_LOCK_LATER, NOW)).toBe(false);
  });

  it('locks at the auto-lock instant itself (now() >= auto_lock_at)', () => {
    expect(isListLocked({ ...OPEN, autoLockAt: new Date(NOW).toISOString() }, NOW)).toBe(true);
  });
});

describe('canWriteGuests mirrors can_write_guests', () => {
  it('admin writes every list, even a cancelled or locked one', () => {
    for (const ev of [OPEN, LOCKED, AUTO_LOCKED, CANCELLED]) expect(canWriteGuests(viewer(['admin']), ev, NOW)).toBe(true);
  });

  it('nobody but admin writes a cancelled event', () => {
    expect(canWriteGuests(viewer(['staff']), CANCELLED, NOW)).toBe(false);
    expect(canWriteGuests(viewer(['doorhost']), CANCELLED, NOW)).toBe(false);
    expect(canWriteGuests(viewer([], true), CANCELLED, NOW)).toBe(false);
  });

  it('organizer and doorhost ignore the list lock (#23)', () => {
    expect(canWriteGuests(viewer([], true), LOCKED, NOW)).toBe(true);
    expect(canWriteGuests(viewer(['doorhost']), AUTO_LOCKED, NOW)).toBe(true);
  });

  it('staff writes an open list, not a locked or auto-locked one (#23)', () => {
    expect(canWriteGuests(viewer(['staff']), OPEN, NOW)).toBe(true);
    expect(canWriteGuests(viewer(['staff']), AUTO_LOCK_LATER, NOW)).toBe(true);
    expect(canWriteGuests(viewer(['staff']), LOCKED, NOW)).toBe(false);
    expect(canWriteGuests(viewer(['staff']), AUTO_LOCKED, NOW)).toBe(false);
  });

  it('finance, user_manager and a non-organizer without roles never write', () => {
    expect(canWriteGuests(viewer(['finance']), OPEN, NOW)).toBe(false);
    expect(canWriteGuests(viewer(['user_manager']), OPEN, NOW)).toBe(false);
    expect(canWriteGuests(viewer([]), OPEN, NOW)).toBe(false);
  });
});

describe('canUpdateGuest mirrors guests_update', () => {
  it('staff may change only the guests they added', () => {
    expect(canUpdateGuest(viewer(['staff']), OPEN, MINE, NOW)).toBe(true);
    expect(canUpdateGuest(viewer(['staff']), OPEN, THEIRS, NOW)).toBe(false);
    // An auto-approved link guest belongs to nobody's meter, so not to staff either.
    expect(canUpdateGuest(viewer(['staff']), OPEN, VIA_LINK, NOW)).toBe(false);
  });

  it('staff loses even their own guests once the list locks', () => {
    expect(canUpdateGuest(viewer(['staff']), LOCKED, MINE, NOW)).toBe(false);
  });

  it('admin, doorhost and the event organizer may change anyone', () => {
    expect(canUpdateGuest(viewer(['admin']), LOCKED, THEIRS, NOW)).toBe(true);
    expect(canUpdateGuest(viewer(['doorhost']), LOCKED, VIA_LINK, NOW)).toBe(true);
    expect(canUpdateGuest(viewer([], true), OPEN, THEIRS, NOW)).toBe(true);
  });

  it('an organizer of ANOTHER event gets nothing here', () => {
    expect(canUpdateGuest(viewer([], false), OPEN, THEIRS, NOW)).toBe(false);
  });

  it('an anonymized row is read-only for everyone, admin included (#29)', () => {
    expect(canUpdateGuest(viewer(['admin']), OPEN, { addedBy: ME, anonymized: true }, NOW)).toBe(false);
  });

  it('staff never matches an own-row check without a user id', () => {
    const anon: GuestWriteViewer = { roles: ['staff'], userId: null, isOrganizer: false };
    expect(canUpdateGuest(anon, OPEN, VIA_LINK, NOW)).toBe(false);
  });
});

describe('profileRowActions (what the "…" sheet offers)', () => {
  const run = (v: GuestWriteViewer, event: GuestWriteEvent, row: GuestWriteRow, tierCount: number | null = 3) =>
    profileRowActions({ viewer: v, event, row, tierCount, nowMs: NOW });

  it('a door-only viewer may only open the event (G4, Max on PR #304)', () => {
    const openOnly = { openEvent: true, editPlusOnes: false, changeTier: false, remove: false, blockedBy: null };
    // Even though guests_update would let a doorhost write this row.
    expect(canUpdateGuest(viewer(['doorhost']), OPEN, THEIRS, NOW)).toBe(true);
    expect(run(viewer(['doorhost']), OPEN, THEIRS)).toEqual(openOnly);
    // The seed door persona holds {doorhost, staff}: still door-only, own row or not.
    expect(run(viewer(['doorhost', 'staff']), OPEN, MINE)).toEqual(openOnly);
    // No lock note either: the lock isn't what keeps them out.
    expect(run(viewer(['doorhost', 'staff']), LOCKED, MINE)).toEqual(openOnly);
  });

  it('a doorhost who is also admin keeps every action', () => {
    expect(run(viewer(['doorhost', 'admin']), OPEN, THEIRS)).toMatchObject({
      openEvent: true,
      editPlusOnes: true,
      changeTier: true,
      remove: true,
    });
  });

  it('admin gets open + edit +N + tier + remove on any list', () => {
    expect(run(viewer(['admin']), LOCKED, THEIRS)).toEqual({
      openEvent: true,
      editPlusOnes: true,
      changeTier: true,
      remove: true,
      blockedBy: null,
    });
  });

  it('staff on an open list: all actions on their own guest, only "open" on someone else\'s', () => {
    expect(run(viewer(['staff']), OPEN, MINE)).toMatchObject({ editPlusOnes: true, changeTier: true, remove: true });
    expect(run(viewer(['staff']), OPEN, THEIRS)).toEqual({
      openEvent: true,
      editPlusOnes: false,
      changeTier: false,
      remove: false,
      blockedBy: null,
    });
  });

  it('staff on a locked list: no write actions, and the lock is named as the reason (#23)', () => {
    expect(run(viewer(['staff']), LOCKED, MINE)).toEqual({
      openEvent: true,
      editPlusOnes: false,
      changeTier: false,
      remove: false,
      blockedBy: 'locked',
    });
    expect(run(viewer(['staff']), AUTO_LOCKED, MINE).blockedBy).toBe('locked');
  });

  it('only names the lock when the lock is what is in the way', () => {
    // Not their guest: unlocking would not help, so no lock note.
    expect(run(viewer(['staff']), LOCKED, THEIRS).blockedBy).toBeNull();
    // Cancelled + locked: the cancel blocks first.
    expect(run(viewer(['staff']), { ...LOCKED, cancelled: true }, MINE).blockedBy).toBeNull();
  });

  it('finance and user_manager may only open the event', () => {
    for (const roles of [['finance'], ['user_manager']] as VenueRole[][]) {
      expect(run(viewer(roles), OPEN, THEIRS)).toEqual({
        openEvent: true,
        editPlusOnes: false,
        changeTier: false,
        remove: false,
        blockedBy: null,
      });
    }
  });

  it('an organizer acts on their own events only', () => {
    expect(run(viewer([], true), LOCKED, THEIRS)).toMatchObject({ editPlusOnes: true, remove: true });
    expect(run(viewer([], false), OPEN, THEIRS)).toMatchObject({ openEvent: true, editPlusOnes: false, remove: false });
  });

  it('offers a tier change only when the event has more than one tier', () => {
    expect(run(viewer(['admin']), OPEN, THEIRS, 2).changeTier).toBe(true);
    expect(run(viewer(['admin']), OPEN, THEIRS, 1).changeTier).toBe(false);
    expect(run(viewer(['admin']), OPEN, THEIRS, 0).changeTier).toBe(false);
    // Tiers still loading: hidden, never guessed.
    expect(run(viewer(['admin']), OPEN, THEIRS, null).changeTier).toBe(false);
  });

  it('never offers a write on an anonymized row, even to admin', () => {
    expect(run(viewer(['admin']), OPEN, { addedBy: ME, anonymized: true })).toMatchObject({
      openEvent: true,
      editPlusOnes: false,
      changeTier: false,
      remove: false,
    });
  });
});
