'use client';

/**
 * Browser/OS back-button ↔ in-app nav-stack bridge for the po `/app` surface.
 *
 * The po app lives on a single `/app` URL with its own in-memory nav stack, so
 * without this the browser back button, the mouse back button, and the Android
 * system/gesture back button would all leave `/app` entirely (→ login) instead of
 * stepping back one screen inside the app. We mirror the in-app depth onto the
 * History API: every "go deeper" (push a screen / open a door overlay) adds a
 * same-URL history entry, a real back fires `popstate` and we pop one in-app
 * level, and the in-app back chevron routes through `history.back()` so there is a
 * single source of truth. At the tab root there is nothing to pop, so back leaves
 * the app naturally (no trap).
 *
 * Capacitor-safe (#37): only the standard History API is used — no URL change, no
 * Next router involvement — so it works identically inside a native webview. The
 * future native wrap only needs an `@capacitor/app` `backButton` listener that
 * calls the same `goBack()`.
 */
import { useEffect, useRef } from 'react';

export interface PoHistoryNav {
  /** Call AFTER a state change that INCREASED in-app depth (push a screen / open a
   *  door overlay). Adds a matching browser-history entry on the same `/app` URL. */
  recordPush: () => void;
  /** Call when collapsing to a tab root (tab switch / openDoor): rewinds exactly the
   *  entries we pushed in one `history.go`, swallowing the resulting popstate. */
  recordReset: () => void;
  /** Programmatic back for the in-app chevron + overlay close — drives the popstate
   *  listener so it shares one code path with the physical back button. No-op at the
   *  root so an in-app back can never accidentally exit the app. */
  goBack: () => void;
}

interface Options {
  /** Only attach the popstate listener once the app is signed-in + nav-hydrated. */
  enabled: boolean;
  /** Pop exactly ONE in-app level (door overlay first, else the top stacked screen).
   *  Must be defensive (a no-op when already at the root) so any count drift can
   *  never over-pop. */
  popLevel: () => void;
}

/** The slice of `history.state` we own. We always spread the existing state so the
 *  Next App Router's own routing key survives (the URL is unchanged, so Next treats
 *  our entries as the same route and never full-reloads). */
interface PoHistoryState {
  poDepth?: number;
}

export function usePoHistoryNav({ enabled, popLevel }: Options): PoHistoryNav {
  // Browser-side mirror of in-app depth: how many `/app` history entries WE pushed.
  const synced = useRef(0);
  // Swallow the single popstate fired by our own `history.go()` in recordReset.
  const guard = useRef(false);
  // Keep the latest popLevel without re-binding the listener every render.
  const popLevelRef = useRef(popLevel);
  popLevelRef.current = popLevel;

  useEffect(() => {
    if (!enabled) return;
    const onPop = (e: PopStateEvent): void => {
      if (guard.current) {
        guard.current = false;
        synced.current = (e.state as PoHistoryState | null)?.poDepth ?? 0;
        return;
      }
      const target = (e.state as PoHistoryState | null)?.poDepth ?? 0;
      // Only a BACKWARD move pops an in-app level; forward / same-depth is a no-op
      // (we don't reconstruct popped screen props — an accepted edge per the plan).
      if (target < synced.current) popLevelRef.current();
      synced.current = target;
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled]);

  return {
    recordPush: () => {
      synced.current += 1;
      window.history.pushState({ ...window.history.state, poDepth: synced.current }, '');
    },
    recordReset: () => {
      if (synced.current > 0) {
        guard.current = true;
        window.history.go(-synced.current);
      }
      synced.current = 0;
    },
    goBack: () => {
      if (synced.current > 0) window.history.back();
    },
  };
}
