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
 * Both rules make this a hard AND across the set: any single member can pin the
 * whole cockpit stale, and — because a query that never succeeds never gets a
 * stamp — with no path back to fresh. That veto is only acceptable over reads
 * the doorhost genuinely steers on, which is why the caller's `tracked` set is
 * deliberately narrow (see `useCockpitSync`) and why a decorative read must not
 * be in it (86eykg2x1 review round 2).
 *
 * Pure and DOM-free on purpose, same as `features/door/sync/staleResume.ts`: the
 * hook around it (`useCockpitSync`) owns the React/browser wiring.
 */

/** The slice of a React Query result this module needs.
 *
 *  `fetchStatus` is deliberately NOT part of this contract. It used to be, to
 *  derive `syncing` from "is any tracked query fetching" — but on this surface
 *  that conflates the guard's own forced refresh with ambient traffic (60s
 *  polling + realtime invalidation), which is not what `useStaleResumeGuard`
 *  means by `syncing`. `useCockpitSync` now tracks the forced refresh itself;
 *  see the note there. Dropping it also stops the cockpit re-rendering on every
 *  fetch start/end, since React Query only subscribes a component to the result
 *  fields it actually reads. */
export interface QueryFreshness {
  dataUpdatedAt: number;
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
