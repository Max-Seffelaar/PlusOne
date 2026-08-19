'use client';

/**
 * Adapter that lets the desktop Event-day cockpit reuse the door's stale-resume
 * guard verbatim (86eykg2x1).
 *
 * `useStaleResumeGuard` needs exactly four things: `online`, `syncing`,
 * `lastSyncAt`, `forceSync`. On the mobile door those come from `useDoorSync`.
 * The cockpit has no `useDoorSync` — it is online-only (no outbox) and reads
 * through independent React Query queries — so this hook synthesises the same
 * four fields from those queries instead of forking a second state machine. The
 * guard, its retry/backstop/continue-anyway behaviour and the overlay component
 * are then shared, not duplicated.
 *
 * Why the cockpit needs the guard at all, despite having no outbox: the screen's
 * whole job is to show numbers a doorhost steers on. `refetchOnWindowFocus` is
 * off on the /app query client, and React Query pauses `refetchInterval` while
 * the document is HIDDEN (another tab in front, window minimized, machine
 * asleep). So a cockpit that was backgrounded — lid closed overnight is the
 * canonical case — resumes showing last night's counts and corrects itself only
 * up to 60s later, or not at all if the realtime channel died while it slept.
 * Loudly blocking on resume until a refresh lands is the point; the absent outbox
 * makes it MORE important, not less, because a check-in attempted against those
 * stale numbers has nowhere to queue — it just fails.
 *
 * Known limit, stated rather than overclaimed: this is a RESUME guard. A cockpit
 * that stays continuously visible (a wall display) never produces a hidden→
 * visible edge, so it is not covered here — the realtime "live" indicator is
 * what speaks to that case.
 *
 * Split of responsibilities between the two arguments:
 *  - `tracked` DETECTS staleness. It must only contain queries with a real
 *    refresh cadence (the cockpit's 60s-polled live reads). A query that never
 *    refreshes on its own would drift past the threshold while the screen sits
 *    perfectly live in the foreground and fire the overlay on every resume — a
 *    false alarm that would train doorhosts to click straight through it.
 *  - `refresh` REPAIRS. It may (and does) cover more than `tracked`: on resume we
 *    want the whole read set back in sync, including the config/task reads whose
 *    age is not a trustworthy staleness signal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import type { StaleResumeSyncSource } from '@/features/door/sync/staleResume';
import { anyQueryInFlight, oldestDataUpdatedAt, type QueryFreshness } from './cockpitFreshness';

export interface CockpitSyncArgs {
  /** The polled live queries whose age defines "is this screen stale". */
  tracked: readonly QueryFreshness[];
  /** Refetch the cockpit's full read set. Called on resume by the guard. */
  refresh: () => void;
}

export function useCockpitSync({ tracked, refresh }: CockpitSyncArgs): StaleResumeSyncSource {
  // React Query's own online signal, not a second `navigator.onLine` listener.
  // It is the very flag RQ consults when deciding whether to run or pause a
  // refetch, so `online: false` here means precisely "the refresh this guard is
  // waiting for will not run yet" — a hand-rolled listener could disagree with
  // the thing we are actually waiting on.
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => onlineManager.subscribe(setOnline), []);

  const lastSyncAt = oldestDataUpdatedAt(tracked);
  const syncing = anyQueryInFlight(tracked);

  // The guard calls `forceSync` from inside a visibilitychange handler it
  // registered once, so it holds whatever closure existed at that moment. Route
  // through a ref so it always reaches the current `refresh`.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const forceSync = useCallback(() => refreshRef.current(), []);

  return useMemo(
    () => ({ online, syncing, lastSyncAt, forceSync }),
    [online, syncing, lastSyncAt, forceSync],
  );
}
