/**
 * Double-tap protection for the one door write that is NOT self-idempotent.
 *
 * Every other outbox kind replays as an idempotent upsert (#25): top-up sends an
 * absolute target, void/revive/undo-refusal match zero rows when already applied,
 * and a re-sent row conflicts on its own client-generated primary key = "already
 * there" = synced. `check_in` is different: it INSERTs a fresh client-generated
 * `check_ins.id` while `check_ins.guest_id` is UNIQUE (one row per guest ever,
 * #11 — `20260613000000_full_schema.sql`). So a SECOND enqueued check_in for the
 * same guest can only ever come back 23505-on-guest_id, which replay.ts (rightly)
 * classifies as `duplicate` — "another device won" — and the doorhost who simply
 * double-tapped their own tablet gets told a colleague checked the guest in (O8).
 *
 * The guard therefore has to run before the ENQUEUE, and it has to read the
 * outbox itself: two taps inside one frame share the same stale render refs, so
 * "is this guest already inside" can only be answered from state that the first
 * tap mutated synchronously (the outbox here; the query cache in DoorProvider).
 */
import type { OutboxEntry } from './types';

/**
 * True when this guest already has a queued check-in that will (or did) create
 * the server row — so a fresh `check_in` INSERT would collide.
 *
 * Entries are appended FIFO, so the LAST matching entry decides: a `check_in_void`
 * after a check-in reopens the guest (their row is voided, not gone — the revive
 * path, not a fresh INSERT, is what re-admits them), and a check-in that settled
 * to `error` (quota/tier/capacity/RLS) never created a row at all, so a retry tap
 * must stay allowed. `duplicate` and `synced` both mean the row exists.
 */
export function hasOpenCheckIn(entries: readonly OutboxEntry[], eventId: string, guestId: string): boolean {
  let open = false;
  for (const e of entries) {
    if (e.eventId !== eventId) continue;
    switch (e.kind) {
      case 'check_in':
      case 'check_in_revive':
        if (e.payload.guestId === guestId) open = e.status !== 'error';
        break;
      case 'check_in_void':
        if (e.payload.guestId === guestId) open = false;
        break;
      default:
        break;
    }
  }
  return open;
}
