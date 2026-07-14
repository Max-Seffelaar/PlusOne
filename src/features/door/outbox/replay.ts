/**
 * Idempotent outbox replay (decisions #11, #25, spec §4 point 5).
 *
 * Each entry maps to one INSERT/UPDATE through the gateway. Replays are safe to
 * repeat: the client-generated PK turns a re-sent row into a no-op (23505 on the
 * pkey = "already there" = synced). The one special case is a check-in: a 23505
 * on the guest_id UNIQUE constraint means another device checked the guest in
 * first — the server's first write wins and ours is marked `duplicate` (#11),
 * while the guest stays "binnen" because they are, in fact, inside.
 *
 * Quota / tier-full / capacity rejections (45001/45002/45005) are terminal
 * `error`s that carry the trigger's Dutch message. So are structurally-invalid
 * writes — FK / permission / CHECK / NOT-NULL violations — which would NEVER
 * succeed on retry and must not wedge the FIFO head (C9). A CODED rejection we
 * don't specifically recognise is transient-for-now but flagged so repeated
 * failures dead-letter instead of blocking the queue forever. Only a CODE-LESS
 * failure (network / offline) is a pure transient that pauses the whole drain.
 */
import type { DbError, DoorGateway } from './gateway';
import { isPending, type OutboxEntry, type OutboxStatus } from './types';

/**
 * Postgres error codes that mean "this write is structurally wrong and will
 * never be accepted" — foreign-key violation, insufficient privilege (an RLS
 * deny, e.g. writing to a locked list), CHECK violation, NOT-NULL violation.
 * Classified terminal so the drain skips past them (C9).
 */
const TERMINAL_CODES = new Set(['23503', '42501', '23514', '23502']);

/** A coded reject retries this many times before it is dead-lettered (C9). */
export const MAX_ATTEMPTS = 5;

export interface ReplayResult {
  status: OutboxStatus;
  message?: string;
  /**
   * True when a `pending` result came from a CODED server rejection we don't
   * specifically handle (not a code-less network failure). The connection is
   * alive, so the drain skips past it rather than pausing — and it dead-letters
   * once it has failed MAX_ATTEMPTS times, so a single bad write can't wedge the
   * queue forever (C9).
   */
  codedReject?: boolean;
}

export function classifyError(error: DbError | null): ReplayResult {
  if (!error) return { status: 'synced' };
  const code = error.code ?? '';
  if (code === '23505') {
    const detail = `${error.details ?? ''} ${error.message ?? ''}`;
    if (detail.includes('guest_id')) {
      return { status: 'duplicate', message: 'Already checked in on another device.' };
    }
    // Conflict on the primary key = our own row already persisted (idempotent).
    return { status: 'synced' };
  }
  if (code === '45001') return { status: 'error', message: error.message ?? 'Quota full for this event.' };
  if (code === '45002') return { status: 'error', message: error.message ?? 'This tier is full.' };
  if (code === '45005') return { status: 'error', message: error.message ?? 'This event is at capacity.' };
  if (TERMINAL_CODES.has(code)) {
    return { status: 'error', message: error.message ?? 'This action was rejected and will not retry.' };
  }
  // A coded rejection we don't recognise: retry for now, but flag it so the drain
  // can skip past it and dead-letter it if it keeps failing (C9).
  if (code) return { status: 'pending', message: error.message ?? 'Rejected. Retrying.', codedReject: true };
  // No code = network / offline → pause the whole drain and retry when back online.
  return { status: 'pending', message: error.message ?? 'Connection failed. Retrying.' };
}

export async function replayEntry(
  gw: DoorGateway,
  entry: OutboxEntry,
  uid: string,
  deviceId: string,
): Promise<ReplayResult> {
  switch (entry.kind) {
    case 'check_in': {
      const p = entry.payload;
      const { error } = await gw.insertCheckIn({
        id: p.id,
        guest_id: p.guestId,
        event_id: entry.eventId,
        checked_by: uid,
        plus_ones_arrived: p.plusOnesArrived,
        client_timestamp: p.clientTimestamp,
        device_id: deviceId,
        offline_synced: true,
      });
      return classifyError(error);
    }
    case 'check_in_topup': {
      const p = entry.payload;
      // Absolute target; the trigger keeps it monotonic + capped, so a re-send or
      // a row owned by another checker (0 rows) is a harmless no-op = synced.
      const { error } = await gw.topUpCheckIn(p.guestId, p.plusOnesArrived);
      return classifyError(error);
    }
    case 'check_in_void': {
      // Idempotent: re-voiding (or a row already voided) matches 0 rows = synced.
      const { error } = await gw.voidCheckIn(entry.payload.guestId, uid);
      return classifyError(error);
    }
    case 'check_in_revive': {
      const p = entry.payload;
      const { error } = await gw.reviveCheckIn(p.guestId, p.plusOnesArrived, uid);
      return classifyError(error);
    }
    case 'refusal': {
      const p = entry.payload;
      const { error } = await gw.insertRefusal({
        id: p.id,
        guest_id: p.guestId,
        event_id: entry.eventId,
        refused_by: uid,
        reason: p.reason,
        client_timestamp: p.clientTimestamp,
        device_id: deviceId,
      });
      return classifyError(error);
    }
    case 'undo_refusal': {
      // Re-admit a mistakenly refused guest. Idempotent: a guest not (or no
      // longer) refused matches 0 rows = synced. The refusal row stays.
      const { error } = await gw.undoRefusal(entry.payload.guestId);
      return classifyError(error);
    }
    case 'add_guest': {
      const p = entry.payload;
      const { error } = await gw.insertGuest({
        id: p.id,
        event_id: entry.eventId,
        tier_id: p.tierId,
        full_name: p.fullName,
        plus_ones: p.plusOnes,
        source: 'door',
        added_by: uid,
      });
      return classifyError(error);
    }
    case 'ack_note': {
      const p = entry.payload;
      const { error } = await gw.ackNote(p.guestId, p.ack, uid);
      return classifyError(error);
    }
  }
}

export interface DrainDeps {
  list: () => OutboxEntry[];
  update: (clientId: string, patch: Partial<OutboxEntry>) => void;
  gateway: DoorGateway;
  uid: string;
  deviceId: string;
}

export interface DrainSummary {
  processed: number;
  synced: number;
  duplicates: number;
  errors: number;
  /** Coded rejects that gave up after MAX_ATTEMPTS and were dead-lettered (C9). */
  deadLettered: number;
  /** A code-less (network/offline) failure paused the drain early. */
  interrupted: boolean;
}

/**
 * Replay every pending entry in FIFO order.
 *
 *  - A code-less failure (network/offline) pauses the drain — every later entry
 *    would fail too, so we don't hammer a dead connection; the next
 *    online/visibility event resumes the whole queue.
 *  - A CODED rejection we don't recognise does NOT pause the drain: the
 *    connection is alive and one bad write must never wedge the entries behind it
 *    (C9). It stays `pending` and is retried on later drains, until it has failed
 *    MAX_ATTEMPTS times, when it is dead-lettered to `error` and skipped for good.
 *  - Terminal errors (quota/tier/capacity + FK/RLS/CHECK/NOT-NULL) settle to
 *    `error` immediately and the drain moves on.
 */
/**
 * The guest a given entry's write targets. `add_guest` has no `guestId` field —
 * its own client-generated guest id IS the identity later entries (check_in,
 * void, top-up, ...) reference via `guestId`. This is the FIFO chain key: C9's
 * cross-guest skip-ahead is fine (an unrelated guest's write must not wait), but
 * skipping ahead of a still-pending predecessor for the SAME guest is exactly the
 * out-of-order replay this guards against (O2).
 */
export function guestKeyOf(entry: OutboxEntry): string {
  return entry.kind === 'add_guest' ? entry.payload.id : entry.payload.guestId;
}

export async function drainOutbox(deps: DrainDeps): Promise<DrainSummary> {
  const summary: DrainSummary = {
    processed: 0,
    synced: 0,
    duplicates: 0,
    errors: 0,
    deadLettered: 0,
    interrupted: false,
  };
  // Guest chains with a predecessor that is still pending after this loop's
  // attempt — every later entry for that same (event, guest) is left untouched
  // rather than replayed out of order (O2). A guest with no blocked predecessor
  // is unaffected, so C9's cross-guest skip-ahead still holds.
  const blockedChains = new Set<string>();
  for (const entry of deps.list().filter(isPending)) {
    const chainKey = `${entry.eventId}:${guestKeyOf(entry)}`;
    if (blockedChains.has(chainKey)) continue;

    deps.update(entry.clientId, { status: 'syncing' });
    let result: ReplayResult;
    try {
      result = await replayEntry(deps.gateway, entry, deps.uid, deps.deviceId);
    } catch (e) {
      // A thrown fetch = the network is down → pure transient, pause the drain.
      result = { status: 'pending', message: e instanceof Error ? e.message : 'Unknown error' };
    }

    if (result.status === 'pending') {
      if (result.codedReject) {
        // Coded-reject budget (O3): only a CODED rejection counts against
        // MAX_ATTEMPTS. A code-less network flap below never touches this
        // counter, so connectivity trouble can't pre-burn a valid entry's budget.
        const attempts = entry.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          // Given up: dead-letter so it stops blocking the queue. Surfaced as a
          // terminal `error` with its message; the drain keeps going, and the
          // chain is NOT blocked — a settled (even if failed) predecessor no
          // longer holds up its guest's later entries.
          deps.update(entry.clientId, { status: 'error', message: result.message, attempts });
          summary.processed++;
          summary.errors++;
          summary.deadLettered++;
          continue;
        }
        // Alive connection, one bad entry — leave it pending. Still-unresolved,
        // so block this guest's chain (O2) while still letting OTHER guests'
        // entries sync this same drain (C9).
        deps.update(entry.clientId, { status: 'pending', message: result.message, attempts });
        summary.processed++;
        blockedChains.add(chainKey);
        continue;
      }
      // Code-less network/offline failure → pause the whole queue; not this
      // entry's fault, so its coded-reject attempts budget is left untouched (O3).
      deps.update(entry.clientId, { status: 'pending', message: result.message });
      summary.processed++;
      summary.interrupted = true;
      break;
    }

    deps.update(entry.clientId, { status: result.status, message: result.message });
    summary.processed++;
    if (result.status === 'synced') summary.synced++;
    if (result.status === 'duplicate') summary.duplicates++;
    if (result.status === 'error') summary.errors++;
  }
  return summary;
}
