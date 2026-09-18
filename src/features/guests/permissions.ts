// Guest write permissions, as the UI sees them (Joeri walkthrough, z8uq9m0hw5).
//
// Pure functions only, no I/O, so they unit-test trivially and run on client and
// server alike. The DATABASE is the security boundary (CLAUDE.md #1): these mirror
// the RLS so a screen can show only the actions that will actually work, and the
// server still refuses anything else. Every rule below points at the SQL it copies;
// if that SQL changes, this file and its test change with it.

import { isDoorOnlyRole, type VenueRole } from '@/features/auth/roles';

/** The event-side facts `can_write_guests` reads. */
export interface GuestWriteEvent {
  cancelled: boolean;
  /** events.list_locked (#23). */
  listLocked: boolean;
  /** events.auto_lock_at, ISO. The list counts as locked from this instant on. */
  autoLockAt: string | null;
}

/** Who is asking, for one event. */
export interface GuestWriteViewer {
  /** Venue roles at the event's venue (venue_memberships.roles). */
  roles: readonly VenueRole[];
  userId: string | null;
  /** event_organizers row for this event (external crew, #6/#24). */
  isOrganizer: boolean;
}

/** The row-side facts `guests_update` reads. */
export interface GuestWriteRow {
  /** guests.added_by; null for an auto-approved request-link guest. */
  addedBy: string | null;
  /** guests.anonymized_at is set (AVG erasure, #29). */
  anonymized: boolean;
}

/** List lock as the database evaluates it: the manual lock OR a passed auto-lock. */
export function isListLocked(event: Pick<GuestWriteEvent, 'listLocked' | 'autoLockAt'>, nowMs: number): boolean {
  if (event.listLocked) return true;
  if (!event.autoLockAt) return false;
  const at = Date.parse(event.autoLockAt);
  return !Number.isNaN(at) && nowMs >= at;
}

/**
 * Mirrors `public.can_write_guests(event_id)` (20260624200000, section 3):
 * admin always; nobody else on a cancelled event; organizer and doorhost ignore
 * the list lock; staff only while the list is open; every other role never.
 */
export function canWriteGuests(viewer: Omit<GuestWriteViewer, 'userId'>, event: GuestWriteEvent, nowMs: number): boolean {
  if (viewer.roles.includes('admin')) return true;
  if (event.cancelled) return false;
  if (viewer.isOrganizer) return true;
  if (viewer.roles.includes('doorhost')) return true;
  if (isListLocked(event, nowMs)) return false;
  return viewer.roles.includes('staff');
}

/**
 * Mirrors the `guests_update` policy (USING and WITH CHECK, 20260613120000 as
 * tightened by 20260811160000): the row is not anonymized, the caller may write
 * the event's list, AND the caller added the guest or is admin/doorhost of the
 * venue or organizer of the event. Soft delete (status 'removed', #21), a +N
 * change and a tier change are all plain updates through this one policy.
 */
export function canUpdateGuest(viewer: GuestWriteViewer, event: GuestWriteEvent, row: GuestWriteRow, nowMs: number): boolean {
  if (row.anonymized) return false;
  if (!canWriteGuests(viewer, event, nowMs)) return false;
  const ownRow = viewer.userId != null && row.addedBy === viewer.userId;
  return ownRow || viewer.roles.includes('admin') || viewer.roles.includes('doorhost') || viewer.isOrganizer;
}

/** Which actions a guest's event row on the person profile offers. */
export interface ProfileRowActions {
  /** Navigate to the event. Read-only, so anyone who sees the row may. */
  openEvent: boolean;
  editPlusOnes: boolean;
  /** Also needs the event to have more than one tier, known only once loaded. */
  changeTier: boolean;
  /** Soft delete to status 'removed' (#21). */
  remove: boolean;
  /** Why the write actions are missing, when that is worth saying. */
  blockedBy: 'locked' | null;
}

const OPEN_ONLY: ProfileRowActions = {
  openEvent: true,
  editPlusOnes: false,
  changeTier: false,
  remove: false,
  blockedBy: null,
};

/**
 * Action visibility for one event row on the person profile.
 *
 * - Everyone who sees the row may open the event: viewing it is harmless.
 * - A door-only viewer gets ONLY that (G4, K-8: the profile is read-only at
 *   the door; the door has its own check-in / refuse flow). Decided by Max on
 *   PR #304, even though `guests_update` would let a doorhost write here.
 * - The three writes follow `canUpdateGuest` exactly. There is no extra UI rule
 *   on top: a checked-in guest can still be edited or removed (the database
 *   allows it, and #22 keeps their slots charged while they are inside).
 * - `changeTier` additionally needs a real choice: more than one tier on the
 *   event. `tierCount` is null while the tiers are loading, which hides it.
 * - `blockedBy: 'locked'` tells a staff member WHY they have no write actions
 *   on a locked list (#23), instead of the actions silently missing.
 */
export function profileRowActions(input: {
  viewer: GuestWriteViewer;
  event: GuestWriteEvent;
  row: GuestWriteRow;
  tierCount: number | null;
  nowMs: number;
}): ProfileRowActions {
  const { viewer, event, row, tierCount, nowMs } = input;
  if (isDoorOnlyRole(viewer.roles)) return OPEN_ONLY;

  const canEdit = canUpdateGuest(viewer, event, row, nowMs);
  // Only worth explaining when the lock is the ONLY thing in the way: the same
  // viewer on an open list would have been able to edit this row.
  const lockedOut =
    !canEdit &&
    !event.cancelled &&
    !row.anonymized &&
    isListLocked(event, nowMs) &&
    canUpdateGuest(viewer, { ...event, listLocked: false, autoLockAt: null }, row, nowMs);

  return {
    openEvent: true,
    editPlusOnes: canEdit,
    changeTier: canEdit && tierCount !== null && tierCount > 1,
    remove: canEdit,
    blockedBy: lockedOut ? 'locked' : null,
  };
}
