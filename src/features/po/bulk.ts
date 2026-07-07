// Pure helpers for the Guests-tab bulk actions (T11): classifying each add into a
// per-row outcome (added / already on list / quota-blocked / tier full / list
// locked / error) and summarizing the batch. Kept pure + I/O-free so the
// orchestration in mutations.ts stays thin and this is unit-tested directly.
import type { MutationError } from '@/lib/db-errors';

/** One person's outcome after a bulk "add to event". */
export type BulkAddOutcome = 'added' | 'already' | 'quota' | 'tierFull' | 'locked' | 'error';

export interface BulkAddRowResult {
  /** Stable key for the row (guest id or contact id). */
  key: string;
  name: string;
  outcome: BulkAddOutcome;
}

type ActionResultLike = { ok: true } | Pick<MutationError, 'ok' | 'code'>;

/**
 * Map an add server-action result to a per-row outcome. The quota engine raises
 * distinct SQLSTATEs (45001 quota, 45002 tier full, 45005 capacity); a list-lock
 * or missing rights both surface as 42501, so "locked" is only reported when the
 * target event's list is actually locked (passed in by the caller).
 */
export function classifyAddResult(res: ActionResultLike, targetLocked: boolean): BulkAddOutcome {
  if (res.ok) return 'added';
  switch (res.code) {
    case '45001':
    case '45005':
      return 'quota';
    case '45002':
      return 'tierFull';
    case '42501':
      return targetLocked ? 'locked' : 'error';
    default:
      return 'error';
  }
}

/** Count each outcome across the batch (drives the summary line + banners). */
export function summarizeBulkAdd(rows: readonly BulkAddRowResult[]): Record<BulkAddOutcome, number> {
  const counts: Record<BulkAddOutcome, number> = {
    added: 0,
    already: 0,
    quota: 0,
    tierFull: 0,
    locked: 0,
    error: 0,
  };
  for (const r of rows) counts[r.outcome] += 1;
  return counts;
}
