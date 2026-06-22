/**
 * Self-heal a missed realtime burst (#0b).
 *
 * Even with a raised `eventsPerSecond` (see REALTIME_EVENTS_PER_SECOND), a channel
 * can still miss events while it is dropped — a transient `CHANNEL_ERROR`, a
 * `TIMED_OUT`, or a `CLOSED`/reconnect (laptop sleep, tab backgrounded, flaky
 * venue wifi). When the channel comes back `SUBSCRIBED` it does NOT replay what
 * happened while it was down, so any check-ins inserted during the gap are
 * invisible until something refetches.
 *
 * This pure helper decides, purely from the previous and next channel status,
 * whether a (re)subscribe should trigger a refetch. It returns true ONLY when we
 * transition back to `SUBSCRIBED` *after a drop* — never on the very first
 * `SUBSCRIBED` (the mount effect already does the initial sync, so firing here too
 * would double-fetch). Kept pure so it is unit-tested with no DB / no socket; the
 * calling hook owns the small bit of state (the previous status, in a ref).
 */

/**
 * The realtime channel status surfaced to a `.subscribe(cb)` callback. This mirrors
 * supabase-js's `REALTIME_SUBSCRIBE_STATES` string values (`SUBSCRIBED`,
 * `TIMED_OUT`, `CLOSED`, `CHANNEL_ERROR`) without importing the enum, so the helper
 * and its test stay dependency-free and node-only.
 */
export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR';

/** The drop states a channel passes through before it can resubscribe. */
const DROP_STATES: ReadonlySet<ChannelStatus> = new Set<ChannelStatus>([
  'CHANNEL_ERROR',
  'TIMED_OUT',
  'CLOSED',
]);

/**
 * True when `next` is a *re*-subscribe after a drop, i.e. we should refetch to
 * close the gap. False on the first connect (`prev == null`), on a steady
 * `SUBSCRIBED → SUBSCRIBED`, and on any non-`SUBSCRIBED` next status.
 *
 * @param prev the previous status the callback saw, or null before the first one.
 * @param next the status just received.
 */
export function shouldRefetchOnStatus(prev: ChannelStatus | null, next: ChannelStatus): boolean {
  if (next !== 'SUBSCRIBED') return false;
  if (prev == null) return false; // initial connect — mount effect already synced.
  return DROP_STATES.has(prev);
}
