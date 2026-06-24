'use client';

/**
 * Browser/OS back-button ↔ in-app nav-stack bridge for the po `/app` surface.
 *
 * The po app lives on ONE `/app` URL with its own in-memory nav stack, so without
 * this the physical back button (browser, mouse, **Android system/gesture**) would
 * leave `/app` entirely (→ login) instead of stepping back one screen.
 *
 * Model — "single sentinel" (NOT a depth counter). At any moment there is AT MOST
 * ONE extra history entry above the `/app` baseline while the user is below a tab
 * root. Going deeper never adds more entries; each real back consumes the sentinel,
 * pops exactly one in-app level, and (if still below the root) re-arms a fresh
 * sentinel. This avoids the fragile multi-step `history.go(-N)` of a counter model
 * (which desynced on tab switches → "back works in some places, not others"):
 * collapsing to a tab root is always a single `history.back()`.
 *
 * Capacitor-safe (#37): standard History API only, same URL, no router change; the
 * native wrap just needs an `@capacitor/app` `backButton` listener → `goBack()`.
 */
import { useEffect, useRef } from 'react';

export interface PoHistoryNav {
  /** Call AFTER a state change that INCREASED in-app depth (push a screen / open a
   *  door overlay). Arms the single sentinel if not already armed. */
  recordPush: () => void;
  /** Call when collapsing to a tab root (tab switch / openDoor). Consumes the
   *  sentinel in ONE `history.back()` (the in-app state was already reset). */
  recordReset: () => void;
  /** Programmatic back for the in-app chevron + overlay close — drives the same
   *  popstate path as the physical back button. No-op at a tab root. */
  goBack: () => void;
}

interface Options {
  /** Only attach the popstate listener once the app is signed-in + nav-hydrated. */
  enabled: boolean;
  /** Current in-app depth: pushed-screen count, or 1 when a door overlay is open
   *  (0 at a tab root). Read live by the popstate handler to decide re-arming. */
  depth: number;
  /** Pop exactly ONE in-app level (door overlay first, else the top stacked
   *  screen). Must be defensive (a no-op at the root). */
  popLevel: () => void;
}

export function usePoHistoryNav({ enabled, depth, popLevel }: Options): PoHistoryNav {
  // Is our single sentinel entry currently on top? (Invariant: armed ⟺ depth > 0.)
  const armed = useRef(false);
  // Swallow the popstate from our own programmatic history.back() in recordReset.
  const guard = useRef(false);
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const popLevelRef = useRef(popLevel);
  popLevelRef.current = popLevel;

  const pushSentinel = (): void => {
    // Spread Next's internal history.state (its router key) so the App Router does
    // not break on popstate; the URL is unchanged so it stays the same route.
    window.history.pushState({ ...window.history.state, poSentinel: true }, '');
    armed.current = true;
  };

  useEffect(() => {
    if (!enabled) return;
    const onPop = (): void => {
      if (guard.current) {
        // Our own history.back() (recordReset) — consumed the sentinel, nothing to pop.
        guard.current = false;
        armed.current = false;
        return;
      }
      if (!armed.current) return; // at a tab root → let the browser leave (exit).
      armed.current = false; // the real back consumed our sentinel
      if (depthRef.current > 0) {
        popLevelRef.current();
        if (depthRef.current - 1 > 0) pushSentinel(); // still below the root → re-arm
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled]);

  return {
    recordPush: () => {
      if (!armed.current) pushSentinel();
    },
    recordReset: () => {
      if (armed.current) {
        guard.current = true;
        window.history.back();
      }
    },
    goBack: () => {
      if (armed.current) window.history.back();
    },
  };
}
