/**
 * Stale-resume guard (86ey6x56p, spec §4): a door device that was backgrounded
 * (screen locked, app switched away, phone pocketed) for a while must not
 * silently keep showing its last-known guest list once it wakes back up. When
 * the door screen returns to the foreground and the last successful sync is
 * older than the threshold, the caller opens a blocking overlay that forces a
 * sync before any further check-in — the door itself must never "fall shut"
 * quietly on stale data; it degrades loudly instead.
 *
 * Pure edge-detector, same shape as reconnect.ts's `shouldRefetchOnStatus`: it
 * only fires on a genuine hidden→visible transition — never the very first
 * visibility observation (the provider's own mount-time sync already covers
 * that) and never a visible→visible no-op (background timers ticking `now`).
 * Kept pure so it is unit-tested with no DOM; the calling hook owns the small
 * bit of state (the previous visibility, in a ref).
 */

export type PageVisibility = 'visible' | 'hidden';

export interface StaleResumeInputs {
  /** Previous visibility this guard observed, or null before the first one. */
  prev: PageVisibility | null;
  next: PageVisibility;
  /** Epoch ms of the last successful full sync, or null if never synced. */
  lastSyncAt: number | null;
  now: number;
  thresholdMs: number;
}

/** Default staleness threshold before a resume is treated as too old to trust
 *  (task spec: "~5 min, configureerbaar" — callers may override). */
export const DEFAULT_STALE_RESUME_MS = 5 * 60_000;

/**
 * True exactly when `next` is a resume (a real hidden→visible transition, not
 * the first-ever observation and not a same-state no-op) AND the last
 * successful sync is stale relative to `thresholdMs`. A `lastSyncAt` of
 * `null` (never synced) always counts as stale.
 */
export function shouldShowStaleResumeOverlay({ prev, next, lastSyncAt, now, thresholdMs }: StaleResumeInputs): boolean {
  if (next !== 'visible') return false;
  if (prev == null || prev === 'visible') return false; // first observation / already visible — not a resume
  const elapsed = lastSyncAt == null ? Number.POSITIVE_INFINITY : now - lastSyncAt;
  return elapsed >= thresholdMs;
}
