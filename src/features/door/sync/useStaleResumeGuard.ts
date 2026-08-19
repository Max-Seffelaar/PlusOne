'use client';

/**
 * React glue for the stale-resume guard (86ey6x56p). Consumes an EXISTING sync
 * status (a `StaleResumeSyncSource`) rather than building a second sync
 * mechanism — CLAUDE.md forbids duplicating the door's offline outbox/sync
 * path, and this only needs to observe + kick it.
 *
 * Two surfaces feed it today: the mobile door passes `useDoorSync`'s state
 * (`sync.ts`/`useDoorSync.ts`), and the desktop Event-day cockpit passes a
 * React-Query-derived equivalent (`features/po/eventday/useCockpitSync`,
 * 86eykg2x1). Everything below is written against the four-field contract only,
 * so neither surface gets its own copy of this state machine.
 *
 * State machine:
 *  - `closed`   → nothing to show.
 *  - `syncing`  → just resumed with a stale last-sync; a forced sync is
 *                 running (with one internal retry if a pre-existing, doomed
 *                 attempt swallowed it — see the resolve effect), the caller
 *                 renders a blocking (non-dismissable) overlay.
 *  - `blocked`  → the forced sync (+ its one retry) settled without leaving
 *                 us freshly synced (offline, or a slow/stuck request past
 *                 the backstop timeout) — the caller shows a warning with a
 *                 "retry" action and an explicit "continue anyway" escape
 *                 hatch. The door must never lock up with no way out (hard
 *                 requirement).
 *
 * Both consumers render the overlay AND `inert` their own content behind it, so
 * this hook also owns focus restoration across that transition — see
 * `restoreFocusRef` below.
 *
 * `blocked` self-heals back to `closed` the moment `lastSyncAt` is fresh again
 * — from this guard's own retry, the 60s safety interval, or a realtime
 * reconnect (routed through `runSync` in useDoorSync so it actually updates
 * `lastSyncAt`/`syncing` — see that file) — mirrors the self-heal pattern in
 * reconnect.ts. `continueAnyway` while offline also suppresses re-opening on
 * every subsequent screen unlock until connectivity returns (see below).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_STALE_RESUME_MS,
  isSyncStale,
  shouldShowStaleResumeOverlay,
  type PageVisibility,
  type StaleResumeSyncSource,
} from './staleResume';

/** Escape-hatch timeout: if a forced resume-sync hasn't settled within this
 *  window, offer "continue anyway" even though `online` may still read true —
 *  a hung request (bad wifi, captive portal) must never leave the door
 *  blocked with no way out. */
export const DEFAULT_SYNC_WAIT_TIMEOUT_MS = 8_000;

export type StaleResumeOverlayPhase = 'closed' | 'syncing' | 'blocked';

export interface StaleResumeGuardState {
  phase: StaleResumeOverlayPhase;
  /** True once `blocked` and the device is genuinely offline (vs. a slow/stuck
   *  attempt while nominally online) — drives which copy the overlay shows. */
  offline: boolean;
  /** Doorhost explicitly chooses to proceed on the last list they have. While
   *  offline, this also suppresses re-opening the overlay on every subsequent
   *  screen unlock for the rest of the offline period — the doorhost already
   *  acknowledged the risk once; re-blocking on every unlock while genuinely
   *  offline would just be door-speed friction for no new information. The
   *  suppression clears the moment connectivity returns. */
  continueAnyway: () => void;
  /** Retry the sync from `blocked` without waiting for the next resume — re-opens
   *  `syncing` and re-arms the backstop timeout. */
  retry: () => void;
}

export function useStaleResumeGuard(
  sync: StaleResumeSyncSource,
  thresholdMs: number = DEFAULT_STALE_RESUME_MS,
  syncWaitTimeoutMs: number = DEFAULT_SYNC_WAIT_TIMEOUT_MS,
): StaleResumeGuardState {
  const [phase, setPhase] = useState<StaleResumeOverlayPhase>('closed');
  const prevVisibility = useRef<PageVisibility | null>(null);
  const syncRef = useRef(sync);
  syncRef.current = sync;
  // Whether we've actually observed `sync.syncing === true` since the current
  // `syncing` phase opened. `forceSync()` and `sync.syncing` flipping true are
  // two separate state updates (ours + useDoorSync's) that land in the same
  // React commit in real usage (both are triggered synchronously inside the
  // same visibilitychange dispatch), but nothing guarantees `syncing` is
  // already true on the very first render after we open — without this guard
  // a `syncing` prop that is still momentarily `false` would read as "the
  // attempt already settled" and downgrade straight to `blocked` before the
  // sync ever ran.
  const attemptSeenRef = useRef(false);
  // A settled-but-unfresh attempt may have been a PRE-EXISTING sync that was
  // already doomed before our resume even happened (e.g. it started right as
  // the network dropped) and simply swallowed our own forceSync() call via
  // the shared inFlight guard in useDoorSync — our own attempt never actually
  // ran. Give the resolve effect exactly one genuine retry before it gives up.
  const retriedOnceRef = useRef(false);
  // Set once `continueAnyway` is used while offline; cleared the moment
  // connectivity returns (see the effect below).
  const suppressWhileOfflineRef = useRef(false);
  // What had focus when the overlay opened, so it can be handed back when the
  // overlay closes. Both consumers set `inert` on their own subtree while
  // blocked, and the browser blurs the focused element the moment its ancestor
  // becomes inert — on the door that is AddOnSpot's autofocused Enter-to-commit
  // field, on the cockpit the Enter-to-check-in search box, i.e. exactly the
  // keyboard/scanner-wedge target `inert` is there to protect. Nothing puts it
  // back by itself. On the common online path the overlay flashes for about a
  // second and auto-closes, and the next scan then types into `<body>`: no
  // check-in, no error, nothing on screen to explain it. Same after
  // `continueAnyway`, whose autofocused button is unmounted with focus on it.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Edge-detect a real resume (hidden → visible) and open the blocking
  // overlay when the last successful sync is too old to trust. Seeded from
  // the CURRENT visibility at registration time (not `null`) so a door screen
  // that mounts already hidden (backgrounded tab/webview) is still guarded on
  // its first reveal, instead of that first reveal being mistaken for "the
  // initial observation" and skipped.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (prevVisibility.current == null) {
      prevVisibility.current = document.visibilityState === 'visible' ? 'visible' : 'hidden';
    }
    const onVisibilityChange = (): void => {
      const next: PageVisibility = document.visibilityState === 'visible' ? 'visible' : 'hidden';
      const trigger = shouldShowStaleResumeOverlay({
        prev: prevVisibility.current,
        next,
        lastSyncAt: syncRef.current.lastSyncAt,
        now: Date.now(),
        thresholdMs,
      });
      prevVisibility.current = next;
      if (!trigger) return;
      if (suppressWhileOfflineRef.current && !syncRef.current.online) return; // already acknowledged this offline period
      // Capture BEFORE the state update: `inert` lands during React's commit,
      // which is also when the browser blurs — by the time any effect runs,
      // `document.activeElement` is already `<body>`. This handler is the only
      // closed→open edge (`retry` only ever runs from `blocked`, i.e. already
      // open and already blurred).
      const active = document.activeElement;
      restoreFocusRef.current =
        active && active !== document.body && typeof (active as HTMLElement).focus === 'function'
          ? (active as HTMLElement)
          : null;
      setPhase('syncing');
      // useDoorSync's own visibility listener also fires on this same event
      // and shares the same in-flight guard (runSync), so this either kicks
      // off the sync or safely no-ops if that listener already did.
      syncRef.current.forceSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [thresholdMs]);

  // A freshly (re-)opened `syncing` phase hasn't observed its own attempt in
  // flight yet, and gets its own fresh shot at the one-retry backstop.
  useEffect(() => {
    if (phase === 'syncing') {
      attemptSeenRef.current = false;
      retriedOnceRef.current = false;
    }
  }, [phase]);

  // Connectivity returning clears the offline continue-anyway suppression —
  // the next stale resume should be guarded normally again.
  useEffect(() => {
    if (sync.online) suppressWhileOfflineRef.current = false;
  }, [sync.online]);

  // Resolve automatically the moment we're freshly synced — from the forced
  // sync above, the 60s safety interval, or a reconnect self-heal — never
  // require "continue anyway" once good data is back. Freshness alone (NOT
  // `sync.online`) is the proof: a `lastSyncAt` that just landed already
  // proves connectivity worked at that moment, even if `online` is
  // momentarily flickering for an unrelated reason.
  useEffect(() => {
    if (phase === 'closed') return;
    if (sync.syncing) {
      attemptSeenRef.current = true;
      return; // still mid-attempt
    }
    const fresh = !isSyncStale(sync.lastSyncAt, Date.now(), thresholdMs);
    if (fresh) {
      setPhase('closed');
      return;
    }
    if (phase === 'syncing' && attemptSeenRef.current) {
      if (!retriedOnceRef.current) {
        retriedOnceRef.current = true;
        attemptSeenRef.current = false;
        syncRef.current.forceSync();
        return;
      }
      // The forced attempt (and its one retry) settled without leaving us fresh.
      setPhase('blocked');
    }
  }, [phase, sync.syncing, sync.lastSyncAt, thresholdMs]);

  // Hand focus back on the closed transition. Only when focus actually went
  // nowhere (`<body>`, where the inert-blur and the unmounted overlay button
  // both leave it) — if the operator has meanwhile focused something else, or
  // the browser never blurred in the first place, stealing it back would be the
  // worse bug. `isConnected` because the element may have been unmounted by a
  // re-render while the overlay was up. No-ops on mount: the ref starts null.
  useEffect(() => {
    if (phase !== 'closed') return;
    const el = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (!el || !el.isConnected) return;
    if (typeof document === 'undefined') return;
    if (document.activeElement && document.activeElement !== document.body) return;
    el.focus({ preventScroll: true });
  }, [phase]);

  // Backstop: a hung/never-settling request must not block the door forever,
  // regardless of how many internal retries are still in flight above.
  useEffect(() => {
    if (phase !== 'syncing') return;
    const id = setTimeout(() => setPhase((p) => (p === 'syncing' ? 'blocked' : p)), syncWaitTimeoutMs);
    return () => clearTimeout(id);
  }, [phase, syncWaitTimeoutMs]);

  const continueAnyway = useCallback(() => {
    if (!syncRef.current.online) suppressWhileOfflineRef.current = true;
    setPhase('closed');
  }, []);

  const retry = useCallback(() => {
    setPhase('syncing');
    syncRef.current.forceSync();
  }, []);

  return { phase, offline: !sync.online, continueAnyway, retry };
}
