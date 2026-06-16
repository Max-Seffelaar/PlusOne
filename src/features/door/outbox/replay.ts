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
  // Permanent data/constraint errors (invalid UUID 22P02, not-null/FK/check 23xxx —
  // 23505 is handled above) can never succeed on retry. Dead-letter them so a
  // malformed entry never blocks the FIFO queue behind it (head-of-line blocking).
  if (/^22/.test(code) || /^23/.test(code)) {
    return { status: 'error', message: error.message ?? 'Ongeldige invoer — overgeslagen.' };
  }
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
    case 'set_arrival': {
      const p = entry.payload;
      const { error } = await gw.updateArrival(p.guestId, p.plusOnesArrived);
      return classifyError(error);
    }
    case 'void_check_in': {
      const p = entry.payload;
      const { error } = await gw.voidCheckIn(p.guestId);
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
/** A still-pending entry that has failed this many times is treated as poison and
 *  dead-lettered, so a single bad row can never block the queue behind it. */
const MAX_ATTEMPTS = 6;

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
    const attempts = entry.attempts + 1;
    // A still-pending entry that has exhausted its retries is poison (or a row the
    // server will never accept): dead-letter it as `error` and keep draining so it
    // can't block the entries queued behind it (head-of-line blocking).
    const deadLettered = result.status === 'pending' && attempts >= MAX_ATTEMPTS;
    const status: OutboxStatus = deadLettered ? 'error' : result.status;
    deps.update(entry.clientId, {
      status,
      message: deadLettered ? result.message ?? 'Te vaak mislukt — overgeslagen.' : result.message,
      attempts,
    });
    summary.processed++;
    if (status === 'synced') summary.synced++;
    if (status === 'duplicate') summary.duplicates++;
    if (status === 'error') summary.errors++;
    if (status === 'pending') {
      summary.interrupted = true;
      break;
    }
  }
  return summary;
}
