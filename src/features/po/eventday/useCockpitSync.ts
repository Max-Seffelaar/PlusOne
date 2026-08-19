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
 *  - `tracked` DETECTS staleness. Two things must be true of every member: it
 *    has a real refresh cadence (the cockpit's 60s-polled live reads), and the
 *    doorhost actually steers on it. Cadence alone is not enough — see the veto
 *    note on `oldestDataUpdatedAt`: any single member that stops succeeding pins
 *    `lastSyncAt` stale with no self-heal path, so membership is a veto over the
 *    whole screen and is spent only on load-bearing reads.
 *  - `refresh` REPAIRS. It may (and does) cover more than `tracked`: on resume we
 *    want the whole read set back in sync, including the config/task reads whose
 *    age is not a trustworthy staleness signal and the decorative ones that are
 *    not allowed to raise the alarm.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onlineManager } from '@tanstack/react-query';
import type { StaleResumeSyncSource } from '@/features/door/sync/staleResume';
import { oldestDataUpdatedAt, type QueryFreshness } from './cockpitFreshness';

export interface CockpitSyncArgs {
  /** The polled, load-bearing live queries whose age defines "is this screen
   *  stale". Each member holds a veto — keep it narrow. */
  tracked: readonly QueryFreshness[];
  /** Refetch the cockpit's full read set. Called on resume by the guard. Must
   *  resolve when that refresh has settled (success or failure) — that promise
   *  is what `syncing` is derived from. */
  refresh: () => Promise<unknown>;
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

  // `syncing` counts OUR OWN forced refreshes, not cockpit traffic in general
  // (86eykg2x1 review round 2). The guard reads `syncing` as "the attempt I just
  // asked for is still running" — it bails out of its resolve effect while it is
  // true. Deriving it from "is any tracked query fetching" broke that meaning on
  // this surface: the four tracked reads are on a 60s `refetchInterval` AND are
  // invalidated by `usePoEventRealtime` on every check-in (throttled to 500ms).
  // During a door rush that is near-continuous, so the blocking overlay could
  // not close over a cockpit whose stamps were demonstrably fresh, and the 8s
  // backstop would then flip it to the "connection is stuck" copy on a screen
  // that was in fact live. On the door `syncing` is one explicit sync cycle, so
  // idle gaps are reliable; with four independently-polled queries plus realtime
  // they are not. Counting the forced refresh directly restores the meaning the
  // guard assumes, on both surfaces.
  //
  // A refetch that React Query has PAUSED because it believes we are offline
  // keeps its promise pending, so it keeps `syncing` true — deliberately: the
  // attempt exists and will resume by itself once connectivity returns, and
  // reporting it as settled would tell the guard the refresh already failed when
  // it has not actually been tried. The 8s backstop is what bounds that wait.
  const [forcedInFlight, setForcedInFlight] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // The guard calls `forceSync` from inside a visibilitychange handler it
  // registered once, so it holds whatever closure existed at that moment. Route
  // through a ref so it always reaches the current `refresh`.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const forceSync = useCallback(() => {
    setForcedInFlight((n) => n + 1);
    void (async () => {
      try {
        await refreshRef.current();
      } catch {
        // A failed refresh is not an exception to handle here — it simply leaves
        // `lastSyncAt` where it was, which is exactly the "still stale" signal
        // the guard then acts on. Swallowed so it can never surface as an
        // unhandled rejection on a screen that is running a door.
      } finally {
        // React batches this with the query-state updates the same refetches
        // produced, so the guard sees "settled" and the new stamps in one
        // render. Were they ever to split, the guard's one internal retry
        // absorbs it: that retry finds the fresh data and closes.
        if (mountedRef.current) setForcedInFlight((n) => (n > 0 ? n - 1 : 0));
      }
    })();
  }, []);

  const syncing = forcedInFlight > 0;

  return useMemo(
    () => ({ online, syncing, lastSyncAt, forceSync }),
    [online, syncing, lastSyncAt, forceSync],
  );
}
