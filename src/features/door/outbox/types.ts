/**
 * Offline outbox model (decision #25, #11, spec §4 point 5). Every door mutation
 * is recorded here first with a client-generated UUIDv7, replayed idempotently
 * when a connection returns. The store is persisted to IndexedDB so queued work
 * survives a reload.
 */

export type OutboxKind = 'check_in' | 'refusal' | 'add_guest' | 'ack_note';

/**
 * pending  — queued, not yet sent (or a transient failure to retry)
 * syncing  — currently being replayed
 * synced   — accepted by the server (or our own row was already there)
 * duplicate— guest already checked in elsewhere; the server's first wins (#11)
 * error    — terminal rejection (quota/tier full); message holds the reason
 */
export type OutboxStatus = 'pending' | 'syncing' | 'synced' | 'duplicate' | 'error';

export interface CheckInPayload {
  /** Client-generated check_ins.id (UUIDv7). */
  id: string;
  guestId: string;
  /** plus_ones_arrived = total people - 1. */
  plusOnesArrived: number;
  clientTimestamp: string;
}

export interface RefusalPayload {
  id: string;
  guestId: string;
  reason: string;
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
}

export type OutboxEntry =
  | (OutboxBase & { kind: 'check_in'; payload: CheckInPayload })
  | (OutboxBase & { kind: 'refusal'; payload: RefusalPayload })
  | (OutboxBase & { kind: 'add_guest'; payload: AddGuestPayload })
  | (OutboxBase & { kind: 'ack_note'; payload: AckNotePayload });

/** Entries the automatic drainer attempts (transient failures fall back to 'pending'). */
export function isPending(e: OutboxEntry): boolean {
  return e.status === 'pending';
}

/** Entries a manual force-sync retries, including terminal-looking errors. */
export function isRetryable(e: OutboxEntry): boolean {
  return e.status === 'pending' || e.status === 'error';
}

/** True while any entry still needs the network (drives the sync-bar dot). */
export function hasUnsynced(entries: OutboxEntry[]): boolean {
  return entries.some((e) => e.status === 'pending' || e.status === 'syncing');
}
