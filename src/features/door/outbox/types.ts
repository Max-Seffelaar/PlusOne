/**
 * Offline outbox model (decision #25, #11, spec §4 point 5). Every door mutation
 * is recorded here first with a client-generated UUIDv7, replayed idempotently
 * when a connection returns. The store is persisted to IndexedDB so queued work
 * survives a reload.
 */

export type OutboxKind =
  | 'check_in'
  | 'check_in_topup'
  | 'check_in_void'
  | 'check_in_revive'
  | 'refusal'
  | 'undo_refusal'
  | 'add_guest'
  | 'ack_note';

/**
 * pending  — queued, not yet sent (or a transient failure to retry)
 * syncing  — currently being replayed
 * synced   — accepted by the server (or our own row was already there)
 * duplicate— guest already checked in elsewhere; the server's first wins (#11)
 * error    — terminal rejection (quota/tier full); message holds the reason
 * denied   — an undo the database refused because this user may not undo a
 *            check-in at this event (z8uq9m2vg6: the company setting is off and
 *            they are not admin/user manager). Settled like `synced`: never
 *            retried, not a dead letter, pruned on the next clear; the drain
 *            reports it once and the refetch puts the guest back inside.
 */
export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'duplicate' | 'error' | 'denied';

/**
 * Check-in as an ABSOLUTE count (z8uq9m2vg6, spike 9.2): "Check in all (N)",
 * "Check in 1" and a "+1" on a colleague's guest are all this one kind — an
 * upsert on `id` that sets plus_ones_arrived to a number, not a delta. Replays
 * and reorderings are safe because the database drops an older
 * client_timestamp (check_ins_a_stale_guard), keeps the count monotonic and
 * capped (cap_check_in_arrivals), and keeps the first arrival's identity (#11).
 * A second tap while the first is still pending replaces it in the queue
 * (dedup.ts `coalesceCheckIn`) instead of being refused.
 */
export interface CheckInPayload {
  /** check_ins.id: a fresh UUIDv7 for a first check-in, or the id of the row
   *  this device already sees (its own, or a colleague's from the snapshot). */
  id: string;
  guestId: string;
  /** Absolute plus_ones_arrived = people inside - 1. */
  plusOnesArrived: number;
  clientTimestamp: string;
}

/**
 * LEGACY kind (pre-z8uq9m2vg6): a top-up by guest_id. New taps never enqueue
 * it — they upsert a `check_in` on the row's id. It stays parseable and
 * replayable because entries queued by an older bundle may still sit in a
 * device's IndexedDB, and dropping a doorhost's queued door action to tidy a
 * type would be the exact data loss the outbox exists to prevent. Also the
 * fallback when a "+1" targets a guest whose row id this device does not know.
 */
export interface CheckInTopUpPayload {
  guestId: string;
  /**
   * The NEW absolute plus_ones_arrived target (total people - 1), not a delta.
   * Absolute + the cap_check_in_arrivals trigger (monotonic, capped at the
   * allotment) makes a replay idempotent and safe to reorder: re-applying the
   * same target is a no-op and a stale lower target can never lower the count.
   */
  plusOnesArrived: number;
  clientTimestamp: string;
}

export interface CheckInVoidPayload {
  guestId: string;
  /**
   * The check_ins row this device OBSERVED when the doorhost undid the check-in
   * (#35). Replay pins the UPDATE to it, so a colleague's fresh check-in made
   * while we were offline is never voided by our stale queue. Optional: entries
   * written by an older bundle have none and stay guest-scoped (dropping a
   * queued door write would be worse than the narrow window it closes).
   */
  checkInId?: string | null;
  clientTimestamp: string;
}

export interface CheckInRevivePayload {
  guestId: string;
  /** Fresh arrivals on re-checkin (total people - 1); the revive-aware trigger
   *  re-sets rather than holds it monotonic. */
  plusOnesArrived: number;
  /** The observed check_ins row — see CheckInVoidPayload.checkInId (#35). */
  checkInId?: string | null;
  clientTimestamp: string;
}

export interface RefusalPayload {
  id: string;
  guestId: string;
  reason: string;
  clientTimestamp: string;
}

export interface UndoRefusalPayload {
  guestId: string;
  clientTimestamp: string;
}

export interface AddGuestPayload {
  /** Client-generated guests.id (UUIDv7). */
  id: string;
  tierId: string;
  fullName: string;
  plusOnes: number;
}

export interface AckNotePayload {
  guestId: string;
  /** true = acknowledge ("Gezien & opgepakt"), false = reopen. */
  ack: boolean;
}

interface OutboxBase {
  /** Unique per outbox entry. */
  clientId: string;
  eventId: string;
  status: OutboxStatus;
  attempts: number;
  createdAt: string;
  /** Last error / duplicate note, Dutch, surfaced in the UI. */
  message?: string;
  /**
   * The user who PERFORMED this door action, stamped at enqueue (86ey9et0h).
   *
   * Replay used to take the actor from the live session at DRAIN time, which is
   * only the same person while one doorhost owns the device for the whole shift.
   * On a shared tablet that hands over mid-queue it silently rewrote history:
   * A's un-synced check-ins landed under B. Recording it here makes the actor a
   * property of the action instead of a property of whoever happens to be logged
   * in when the network returns.
   *
   * Optional, and it must stay optional: entries persisted by an older bundle
   * have no such field, and dropping a doorhost's queued check-in to enforce a
   * schema would cause exactly the data loss this exists to prevent. Those
   * entries fall back to the drain-time uid, i.e. the old behaviour. Same reason
   * OUTBOX_BUSTER is NOT bumped for this change (a bump discards the queue).
   */
  ownerId?: string;
}

export type OutboxEntry =
  | (OutboxBase & { kind: 'check_in'; payload: CheckInPayload })
  | (OutboxBase & { kind: 'check_in_topup'; payload: CheckInTopUpPayload })
  | (OutboxBase & { kind: 'check_in_void'; payload: CheckInVoidPayload })
  | (OutboxBase & { kind: 'check_in_revive'; payload: CheckInRevivePayload })
  | (OutboxBase & { kind: 'refusal'; payload: RefusalPayload })
  | (OutboxBase & { kind: 'undo_refusal'; payload: UndoRefusalPayload })
  | (OutboxBase & { kind: 'add_guest'; payload: AddGuestPayload })
  | (OutboxBase & { kind: 'ack_note'; payload: AckNotePayload });

/** Entries the automatic drainer attempts (transient failures fall back to 'pending'). */
export function isPending(e: OutboxEntry): boolean {
  return e.status === 'pending';
}

/**
 * On load, an entry left in `syncing` means a drain was killed mid-flight (the
 * PWA was closed, the tab crashed, the phone died). No code path ever completes
 * it, so without this the check-in is silently lost and the sync badge sticks at
 * ≥1 forever. Reset every such entry to `pending` so the next drain replays it —
 * safe because every replay is an idempotent upsert (#25). (C8)
 */
export function resumeStuckEntries(entries: OutboxEntry[]): OutboxEntry[] {
  return entries.map((e) => (e.status === 'syncing' ? ({ ...e, status: 'pending' } as OutboxEntry) : e));
}

/** Entries a manual force-sync retries, including terminal-looking errors. */
export function isRetryable(e: OutboxEntry): boolean {
  return e.status === 'pending' || e.status === 'error';
}

/** True while any entry still needs the network (drives the sync-bar dot). */
export function hasUnsynced(entries: OutboxEntry[]): boolean {
  return entries.some((e) => e.status === 'pending' || e.status === 'syncing');
}

/**
 * Entries queued by a DIFFERENT user than the one now signed in (86ey9et0h).
 *
 * These are drained like any other — never quarantined, never dropped — but the
 * new doorhost is told afterwards that work from the previous user went up under
 * their session, so a hand-off is visible rather than silent. Entries with no
 * `ownerId` (older bundle) are not counted: we genuinely don't know who queued
 * them, and guessing "foreign" would fire the notice on every ordinary reload.
 */
export function foreignEntries(entries: OutboxEntry[], uid: string): OutboxEntry[] {
  return entries.filter((e) => e.ownerId != null && e.ownerId !== uid);
}
