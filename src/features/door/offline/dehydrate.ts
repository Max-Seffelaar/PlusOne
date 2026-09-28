/**
 * Which door queries are allowed to survive in the persisted IndexedDB cache
 * (P-IDB1). Without a filter, PersistQueryClientProvider dehydrates the WHOLE
 * client, so every `['door', eventId]` + `['door-quota', eventId]` query ever
 * opened is written back to IndexedDB on every persist tick. On boot the whole
 * blob is hydrated and immediately re-persisted with a fresh top-level timestamp,
 * so the client-level `maxAge` never expires and the 1-week `gcTime` never fires
 * — 30+ month-old event snapshots ride along forever (5–10 MB that never shrinks,
 * and guest PII that never leaves the device).
 *
 * The fix is a per-query recency gate: persist a door query only while it is
 * still fresh (its own `dataUpdatedAt` within `maxAge`). A months-old event's
 * snapshot has a months-old `dataUpdatedAt`, so it is dropped from the next
 * dehydrate and evicted; the active event (kept fresh by the 60s safety sync
 * while online, and hydrated-then-left-alone while offline) stays.
 *
 * Recency — not "the single active event" — is deliberate: the DoorQueryProvider
 * is a generic wrapper that does not know the active eventId (it wraps both the
 * cockpit and the /door route, and the Deur tab switches events without
 * remounting). Gating on observer-count instead would drop the offline snapshot
 * the moment the Deur tab unmounts, breaking the door's reload-offline guarantee
 * (#25). A week's worth of events is bounded; three months of them was not.
 */
import type { Query } from '@tanstack/react-query';

/** Root query keys the door persists — nothing else may reach IndexedDB. */
const DOOR_QUERY_ROOTS = new Set(['door', 'door-quota']);

/** True if this is a door snapshot/quota query key (`['door', id]` etc.). */
export function isDoorQueryKey(queryKey: readonly unknown[]): boolean {
  const [root] = queryKey;
  return typeof root === 'string' && DOOR_QUERY_ROOTS.has(root);
}

/**
 * Persist a query iff it is a door query, holds data from a successful fetch,
 * and that data was last updated within `maxAge`. `now` is injected so the
 * predicate is pure and unit-testable (callers pass `Date.now()`).
 *
 * "Holds data", not "status is success" (N7). Offline, the snapshot's refetch
 * fails and flips the query to `status: 'error'` while KEEPING its data — which
 * the door keeps rendering. Gating on `status === 'success'` dropped exactly that
 * query from the next persist tick, so the snapshot in IndexedDB was overwritten
 * without it and the SECOND offline reload booted a door with no guest list
 * (Max's device test, 2026-09-28: "the whole page disappears"). `dataUpdatedAt`
 * only moves on a successful fetch, so the recency gate still measures the age
 * of real data.
 */
export function shouldDehydrateDoorQuery(query: Query, now: number, maxAge: number): boolean {
  if (!isDoorQueryKey(query.queryKey)) return false;
  if (query.state.data === undefined || query.state.dataUpdatedAt === 0) return false;
  if (query.state.status !== 'success' && query.state.status !== 'error') return false;
  return now - query.state.dataUpdatedAt <= maxAge;
}

/**
 * A door query that should be swept from the in-memory cache on boot: stale
 * (older than `maxAge`) AND unobserved. The freshness gate alone already keeps
 * it out of the next dehydrate; removing it here also frees the memory a
 * hydrated month-old snapshot would otherwise hold on a low-RAM door phone. The
 * unobserved guard means the active event (which DoorProvider observes) is never
 * touched even in the split second before its first refetch.
 */
export function isStaleDoorQuery(query: Query, now: number, maxAge: number): boolean {
  if (!isDoorQueryKey(query.queryKey)) return false;
  if (query.getObserversCount() > 0) return false;
  return now - query.state.dataUpdatedAt > maxAge;
}
