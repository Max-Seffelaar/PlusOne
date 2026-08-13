/**
 * Validation + merge helpers for the persisted outbox (86ey9e85u — O1/O5/O9).
 * Kept separate from store.ts so the pure logic (parsing, merging) is testable
 * without touching IndexedDB, BroadcastChannel, or Sentry.
 */
import { z } from 'zod';
import type { OutboxEntry, OutboxStatus } from './types';

/**
 * Bump whenever OutboxEntry's shape changes. A stored envelope with a stale
 * buster is dropped rather than cast blindly (O9) — same pattern as
 * DOOR_CACHE_BUSTER (C14) for the RQ snapshot cache.
 */
export const OUTBOX_BUSTER = 'door-outbox-v1';

export interface PersistedOutboxEnvelope {
  buster: typeof OUTBOX_BUSTER;
  entries: OutboxEntry[];
}

const uuid = z.string().uuid();
const ts = z.string().min(1);
const status: z.ZodType<OutboxStatus> = z.enum(['pending', 'syncing', 'synced', 'duplicate', 'error']);

const base = {
  clientId: z.string().min(1),
  eventId: uuid,
  status,
  attempts: z.number().int().min(0),
  createdAt: ts,
  message: z.string().optional(),
  // Nullish, NOT required (86ey9et0h): entries written by a pre-owner-stamp
  // bundle carry no ownerId, and quarantining a doorhost's queued check-in over
  // a missing envelope field is precisely the data loss the owner-stamp exists
  // to prevent. They replay under the drain-time uid, exactly as before.
  // OUTBOX_BUSTER is deliberately NOT bumped for the same reason.
  // Normalised to undefined so the parsed entry matches OutboxBase's `ownerId?:
  // string` exactly — a persisted explicit null must not widen the domain type.
  ownerId: uuid.nullish().transform((v) => v ?? undefined),
};

const outboxEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    ...base,
    kind: z.literal('check_in'),
    payload: z.object({ id: uuid, guestId: uuid, plusOnesArrived: z.number().int().min(0), clientTimestamp: ts }),
  }),
  z.object({
    ...base,
    kind: z.literal('check_in_topup'),
    payload: z.object({ guestId: uuid, plusOnesArrived: z.number().int().min(0), clientTimestamp: ts }),
  }),
  z.object({
    ...base,
    kind: z.literal('check_in_void'),
    // checkInId is nullish on purpose: entries persisted by a pre-#35 bundle
    // have no such field, and quarantining a doorhost's queued void mid-shift
    // would lose a real door action. They replay guest-scoped, as before.
    payload: z.object({ guestId: uuid, checkInId: uuid.nullish(), clientTimestamp: ts }),
  }),
  z.object({
    ...base,
    kind: z.literal('check_in_revive'),
    payload: z.object({
      guestId: uuid,
      plusOnesArrived: z.number().int().min(0),
      checkInId: uuid.nullish(),
      clientTimestamp: ts,
    }),
  }),
  z.object({
    ...base,
    kind: z.literal('refusal'),
    payload: z.object({ id: uuid, guestId: uuid, reason: z.string(), clientTimestamp: ts }),
  }),
  z.object({
    ...base,
    kind: z.literal('undo_refusal'),
    payload: z.object({ guestId: uuid, clientTimestamp: ts }),
  }),
  z.object({
    ...base,
    kind: z.literal('add_guest'),
    payload: z.object({ id: uuid, tierId: uuid, fullName: z.string().min(1), plusOnes: z.number().int().min(0) }),
  }),
  z.object({
    ...base,
    kind: z.literal('ack_note'),
    payload: z.object({ guestId: uuid, ack: z.boolean() }),
  }),
  // Input is `unknown` on purpose: this parses whatever IndexedDB handed back,
  // and `ownerId` accepts a persisted null it normalises away, so the schema's
  // INPUT type is deliberately wider than OutboxEntry. The output type is what
  // this assertion needs to keep pinned to the domain type.
]) satisfies z.ZodType<OutboxEntry, z.ZodTypeDef, unknown>;

export interface ParsedPersistedOutbox {
  entries: OutboxEntry[];
  /** Individually-invalid entries dropped (shape kept, one bad row). */
  droppedInvalid: number;
  /** The whole envelope was missing/stale/legacy-shaped — everything dropped. */
  droppedStaleShape: boolean;
}

/**
 * Parse whatever IndexedDB handed back into a safe entry list. Never throws —
 * a corrupt shape or version-skewed entry is quarantined (dropped), not fatal
 * (O9). `raw` is `unknown` because it comes straight out of idbGet<unknown>.
 */
export function parsePersistedOutbox(raw: unknown): ParsedPersistedOutbox {
  if (raw == null) return { entries: [], droppedInvalid: 0, droppedStaleShape: false };
  // Bare-array legacy shape (the pre-envelope persistence this fix replaces).
  // Salvage per element instead of wiping the whole queue — a doorhost who is
  // offline with unsynced entries at the exact moment the new bundle activates
  // must not silently lose them; that's the class of bug this PR exists to
  // fix (review 2026-07-14). Any element that doesn't validate is still
  // quarantined individually, same as the versioned-envelope path below.
  if (Array.isArray(raw)) return parseCandidates(raw);
  if (
    typeof raw !== 'object' ||
    (raw as Record<string, unknown>).buster !== OUTBOX_BUSTER ||
    !Array.isArray((raw as Record<string, unknown>).entries)
  ) {
    // Any other unrecognized/corrupt/stale-buster shape — nothing in it can be trusted.
    return { entries: [], droppedInvalid: 0, droppedStaleShape: true };
  }
  return parseCandidates((raw as { entries: unknown[] }).entries);
}

function parseCandidates(candidates: unknown[]): ParsedPersistedOutbox {
  const entries: OutboxEntry[] = [];
  let droppedInvalid = 0;
  for (const candidate of candidates) {
    const parsed = outboxEntrySchema.safeParse(candidate);
    if (parsed.success) entries.push(parsed.data);
    else droppedInvalid++;
  }
  return { entries, droppedInvalid, droppedStaleShape: false };
}

export function buildEnvelope(entries: OutboxEntry[]): PersistedOutboxEnvelope {
  return { buster: OUTBOX_BUSTER, entries };
}

/** pending < syncing/error (in flight or needs retry) < synced/duplicate (settled). */
const STATUS_RANK: Record<OutboxStatus, number> = {
  pending: 0,
  syncing: 1,
  error: 1,
  synced: 2,
  duplicate: 2,
};

/**
 * Union two entry lists by clientId. Used both for cross-tab read-merge-before
 * -commit (O1) and for folding entries enqueued mid-`init()` await back in
 * (O5) — the same "don't lose either side" rule applies to both races.
 *
 * On a clientId collision (same entry seen from two sources), keep whichever
 * copy is further along its lifecycle so a merge can never revert a status
 * forward-progress (e.g. `syncing` reverting to `pending`); ties go to the
 * higher attempt count, then to `mine` as the freshest local view.
 *
 * Do NOT special-case a disk-sourced terminal status (`synced`/`duplicate`)
 * to avoid overriding a live in-memory `pending` — that reads as a "forged
 * synced" defense, but it isn't one: the only foothold that lets an attacker
 * write a fake `synced` into IndexedDB is same-origin script execution,
 * which can already corrupt the queue in far easier ways, and disk alone
 * can't distinguish that forgery from a sibling tab that genuinely synced
 * the entry — which is exactly the case this merge exists to adopt correctly
 * (skip a redundant re-send). Security-reviewed 2026-07-14; keep as written.
 */
export function mergeOutboxEntries(mine: OutboxEntry[], other: OutboxEntry[]): OutboxEntry[] {
  const byId = new Map<string, OutboxEntry>();
  for (const e of other) byId.set(e.clientId, e);
  for (const e of mine) {
    const existing = byId.get(e.clientId);
    byId.set(e.clientId, existing ? pickFurtherAlong(existing, e) : e);
  }
  return [...byId.values()];
}

function pickFurtherAlong(other: OutboxEntry, mine: OutboxEntry): OutboxEntry {
  const ro = STATUS_RANK[other.status];
  const rm = STATUS_RANK[mine.status];
  if (ro !== rm) return ro > rm ? other : mine;
  return mine.attempts >= other.attempts ? mine : other;
}
