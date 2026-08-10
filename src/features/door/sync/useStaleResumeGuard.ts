'use client';

/**
 * React glue for the stale-resume guard (86ey6x56p). Consumes the EXISTING
 * sync status from useDoorSync (`sync.ts`/`useDoorSync.ts`) rather than
 * building a second sync mechanism — CLAUDE.md forbids duplicating the door's
 * offline outbox/sync path, and this only needs to observe + kick it.
 *
 * State machine:
 *  - `closed`   → nothing to show.
 *  - `syncing`  → just resumed with a stale last-sync; a forced sync is
 *                 running, the caller renders a blocking (non-dismissable)
 *                 overlay.
 *  - `blocked`  → the forced sync settled without leaving us fresh + online
 *                 (offline, or a slow/stuck request past the backstop
 *                 timeout) — the caller shows a warning with an explicit
 *                 "continue anyway" escape hatch. The door must never lock up
 *                 with no way out (hard requirement).
 *
 * `blocked` self-heals back to `closed` the moment fresh + online is achieved
 * from ANY source (this guard's own forced sync, the 60s safety interval, a
 * realtime reconnect) — mirrors the self-heal pattern in reconnect.ts.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DoorSyncState } from './useDoorSync';
import { DEFAULT_STALE_RESUME_MS, shouldShowStaleResumeOverlay, type PageVisibility } from './staleResume';

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
  /** Doorhost explicitly chooses to proceed on the last list they have. */
  continueAnyway: () => void;
}

export function useStaleResumeGuard(
  sync: DoorSyncState,
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

  // Edge-detect a real resume (hidden → visible) and open the blocking
  // overlay when the last successful sync is too old to trust.
  useEffect(() => {
    if (typeof document === 'undefined') return;
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
      setPhase('syncing');
      // useDoorSync's own visibility listener also fires on this same event
      // and shares the same in-flight guard (runSync), so this either kicks
      // off the sync or safely no-ops if that listener already did.
      syncRef.current.forceSync();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [thresholdMs]);

  // A freshly opened `syncing` phase hasn't observed its own attempt in
  // flight yet — reset before the resolve effect below evaluates.
  useEffect(() => {
    if (phase === 'syncing') attemptSeenRef.current = false;
  }, [phase]);

  // Resolve automatically the moment we're both online and freshly synced —
  // from the forced sync above, the 60s safety interval, or a reconnect
  // self-heal — never require "continue anyway" once good data is back.
  useEffect(() => {
    if (phase === 'closed') return;
    if (sync.syncing) {
      attemptSeenRef.current = true;
      return; // still mid-attempt
    }
    const fresh = sync.online && sync.lastSyncAt != null && Date.now() - sync.lastSyncAt < thresholdMs;
    if (fresh) {
      setPhase('closed');
    } else if (phase === 'syncing' && attemptSeenRef.current) {
      // The forced attempt settled without leaving us fresh + online.
      setPhase('blocked');
    }
  }, [phase, sync.syncing, sync.online, sync.lastSyncAt, thresholdMs]);

  // Backstop: a hung/never-settling request must not block the door forever.
  useEffect(() => {
    if (phase !== 'syncing') return;
    const id = setTimeout(() => setPhase((p) => (p === 'syncing' ? 'blocked' : p)), syncWaitTimeoutMs);
    return () => clearTimeout(id);
  }, [phase, syncWaitTimeoutMs]);

  const continueAnyway = useCallback(() => setPhase('closed'), []);

  return { phase, offline: !sync.online, continueAnyway };
}
