/**
 * Freshness math for the desktop Event-day cockpit's stale-resume guard
 * (86eykg2x1, follow-up on 86ey6x56p).
 *
 * The mobile door has `useDoorSync`, which owns one explicit sync cycle and can
 * therefore report a single `lastSyncAt`. The cockpit has no such thing — it is
 * online-only by design (no outbox) and reads through several independent React
 * Query queries. So "when did this screen last actually see the truth" has to be
 * derived from those queries' own `dataUpdatedAt` stamps.
 *
 * Two rules make that derivation safe:
 *
 *  1. **Take the OLDEST stamp, never the newest.** One query that refetched a
 *     second ago next to four that last succeeded eleven hours ago is still an
 *     eleven-hour-old screen. A doorhost steering on those numbers is steering on
 *     stale data, and the max() reading would hide exactly that.
 *  2. **A query that has never successfully loaded counts as "never synced".**
 *     React Query reports `dataUpdatedAt === 0` until the first success (and keeps
 *     the old stamp when a refetch fails, which is what we want — a failed refresh
 *     must not look like a fresh one). A 0 in the set means part of the screen has
 *     no truth behind it at all, which is at least as bad as an old truth.
 *
 * Pure and DOM-free on purpose, same as `features/door/sync/staleResume.ts`: the
 * hook around it (`useCockpitSync`) owns the React/browser wiring.
 */

/** The slice of a React Query result this module needs. `fetchStatus` is RQ's own
 *  field: `'fetching'` while a request is in flight, `'paused'` when RQ is holding
 *  the request back because it believes the device is offline, `'idle'` otherwise. */
export interface QueryFreshness {
  dataUpdatedAt: number;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

/**
 * Epoch ms of the oldest successful load across `queries`, or `null` when the set
 * proves nothing — either it is empty, or at least one query has never succeeded.
 * `null` is the same "never synced" signal `isSyncStale` already understands.
 */
export function oldestDataUpdatedAt(queries: readonly QueryFreshness[]): number | null {
  if (queries.length === 0) return null;
  let oldest = Infinity;
  for (const q of queries) {
    // `<= 0` rather than `=== 0`: a negative stamp could only come from a broken
    // clock or a hand-built fake, and neither is evidence of a real load.
    if (q.dataUpdatedAt <= 0) return null;
    if (q.dataUpdatedAt < oldest) oldest = q.dataUpdatedAt;
  }
  return oldest;
}

/**
 * True while any tracked query still has an outstanding request — including one
 * React Query has PAUSED because it thinks we're offline. Paused counts as
 * in-flight deliberately: the attempt exists and will resume by itself the moment
 * connectivity returns, so reporting it as "settled" would tell the guard the
 * refresh already failed when it has not actually been tried yet.
 */
export function anyQueryInFlight(queries: readonly QueryFreshness[]): boolean {
  return queries.some((q) => q.fetchStatus !== 'idle');
}
