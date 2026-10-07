/**
 * Second-tap handling for the door's check-in write (z8uq9m2vg6).
 *
 * Until z8uq9m2vg6 a check-in was an INSERT of a fresh client-generated
 * `check_ins.id`, while `check_ins.guest_id` is UNIQUE (one row per guest ever,
 * #11). A second enqueued check-in for the same guest could only come back
 * 23505-on-guest_id = `duplicate` ("another device won"), so the second tap had
 * to be BLOCKED before the enqueue (O8).
 *
 * Now a check-in is an upsert on the row's own id with an ABSOLUTE count
 * ("Check in all (N)" / "Check in 1" are the same write with a different
 * number, spike 9.2). A second tap is therefore not an error to prevent but a
 * newer value for the same write:
 *
 *   - `openCheckInId` finds the id the next tap must reuse, so it upserts the
 *     SAME row instead of inserting a second one;
 *   - `coalesceTarget` finds a still-pending entry for that id which the new
 *     tap may simply replace (last wins) — two taps offline, one row online.
 *
 * Both read the outbox itself, synchronously: two taps inside one frame share
 * the same stale render refs, so only state the first tap already mutated (the
 * outbox here, the query cache in DoorProvider) can answer correctly.
 */
import type { CheckInPayload, OutboxEntry } from './types';

/**
 * The check_ins id a queued check-in for this guest will create (or created),
 * or null when the outbox holds none.
 *
 * Entries are FIFO, so the LAST relevant entry decides. A check-in that settled
 * to `error` (quota/tier/capacity/RLS) never created a row, so it yields null.
 * `synced` / `duplicate` / still-pending entries all name a row id the next tap
 * should reuse — for `duplicate` it is the losing id, but upserting it again
 * returns the same `duplicate`, which is the truthful answer. A void after the
 * check-in keeps the row (soft void, #3): its id stays the one to revive.
 */
export function openCheckInId(entries: readonly OutboxEntry[], eventId: string, guestId: string): string | null {
  let id: string | null = null;
  for (const e of entries) {
    if (e.eventId !== eventId || e.kind !== 'check_in' || e.payload.guestId !== guestId) continue;
    id = e.status === 'error' || e.status === 'denied' ? null : e.payload.id;
  }
  return id;
}

/**
 * The clientId of a still-`pending` check-in entry that a new tap with
 * `payload` may overwrite in place, or null when it must be enqueued as a new
 * entry.
 *
 * Only when that entry is the LAST queued write for this guest: replacing an
 * earlier one would move the new count in front of a later void or revive and
 * change what the queue means. A `syncing` entry is already on the wire and is
 * never touched; the new tap then queues behind it (same id, absolute count,
 * monotonic on the server). Neither is an entry queued by another actor.
 */
export function coalesceTarget(
  entries: readonly OutboxEntry[],
  eventId: string,
  payload: Pick<CheckInPayload, 'id' | 'guestId'>,
  /** Who is tapping (`ownerId`). Only that actor's own pending tap is merged:
   *  on a shared tablet, doorhost A's queued check-in stays A's (86ey9et0h,
   *  review of PR #423, S4). */
  actor?: string,
): string | null {
  let last: OutboxEntry | null = null;
  for (const e of entries) {
    if (e.eventId !== eventId) continue;
    const guest = e.kind === 'add_guest' ? e.payload.id : e.payload.guestId;
    if (guest === payload.guestId) last = e;
  }
  if (!last || last.kind !== 'check_in' || last.status !== 'pending') return null;
  if (last.ownerId !== actor) return null;
  return last.payload.id === payload.id ? last.clientId : null;
}
