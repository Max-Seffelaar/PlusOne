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
 * Quota / tier-full rejections (45001/45002) are terminal `error`s that carry
 * the trigger's Dutch message. Everything else (network, 5xx) is transient and
 * falls back to `pending` so the next drain retries.
 */
import type { DbError, DoorGateway } from './gateway';
import { isPending, type OutboxEntry, type OutboxStatus } from './types';

export interface ReplayResult {
  status: OutboxStatus;
  message?: string;
}

export function classifyError(error: DbError | null): ReplayResult {
  if (!error) return { status: 'synced' };
  const code = error.code ?? '';
  if (code === '23505') {
    const detail = `${error.details ?? ''} ${error.message ?? ''}`;
    if (detail.includes('guest_id')) {
      return { status: 'duplicate', message: 'Al ingecheckt op een ander apparaat.' };
    }
    // Conflict on the primary key = our own row already persisted (idempotent).
    return { status: 'synced' };
  }
  if (code === '45001') return { status: 'error', message: error.message ?? 'Quotum vol voor dit event.' };
  if (code === '45002') return { status: 'error', message: error.message ?? 'Dit tier zit vol.' };
  // Network / server / transient RLS hiccup → retry on the next drain.
  return { status: 'pending', message: error.message ?? 'Verbinding mislukt — opnieuw proberen.' };
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
  /** A transient failure stopped the drain early (likely offline). */
  interrupted: boolean;
}

/**
 * Replay every pending entry in FIFO order. A transient failure stops the drain
 * (the entry stays `pending`) so we don't hammer a dead connection; the next
 * online/visibility event resumes it.
 */
export async function drainOutbox(deps: DrainDeps): Promise<DrainSummary> {
  const summary: DrainSummary = { processed: 0, synced: 0, duplicates: 0, errors: 0, interrupted: false };
  for (const entry of deps.list().filter(isPending)) {
    deps.update(entry.clientId, { status: 'syncing' });
    let result: ReplayResult;
    try {
      result = await replayEntry(deps.gateway, entry, deps.uid, deps.deviceId);
    } catch (e) {
      result = { status: 'pending', message: e instanceof Error ? e.message : 'Onbekende fout' };
    }
    deps.update(entry.clientId, {
      status: result.status,
      message: result.message,
      attempts: entry.attempts + 1,
    });
    summary.processed++;
    if (result.status === 'synced') summary.synced++;
    if (result.status === 'duplicate') summary.duplicates++;
    if (result.status === 'error') summary.errors++;
    if (result.status === 'pending') {
      summary.interrupted = true;
      break;
    }
  }
  return summary;
}
