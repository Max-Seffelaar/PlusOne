'use client';

/**
 * Browser/OS back-button ↔ in-app navigation bridge for the po `/app` surface.
 *
 * The po app lives on ONE `/app` URL with its own in-memory navigation, so without
 * this the physical back button (browser, mouse, **Android system/gesture**) would
 * leave `/app` entirely (→ login) instead of stepping back inside the app.
 *
 * Model — "full navigation history" (Android-style): EVERY forward navigation (push
 * a screen, switch a tab, open the door overlay) records ONE browser-history entry,
 * and `app.tsx` keeps a parallel stack of position snapshots. A real back fires
 * `popstate` → we restore the previous position. So back retraces the WHOLE journey
 * — pushed screens AND tab switches — in reverse, and only exits the app at the very
 * first position. The in-app chevron + overlay-close go through `goBack()` so they
 * share the exact same path as the physical button.
 *
 * Capacitor-safe (#37): standard History API only, same URL, no router change; the
 * native wrap just needs an `@capacitor/app` `backButton` listener → `goBack()`.
 */
import { useEffect, useRef } from 'react';

export interface PoHistoryNav {
  /** Call on every FORWARD navigation (push / tab switch / open overlay), right
   *  after recording the previous position. Adds one `/app` history entry. */
  recordNavigate: () => void;
  /** Programmatic back for the in-app chevron + overlay close — drives the same
   *  popstate path as the physical back button. */
  goBack: () => void;
}

interface Options {
  /** Only attach the popstate listener once the app is signed-in + nav-hydrated. */
  enabled: boolean;
  /** Restore the previous navigation position (pop one snapshot). Called on every
   *  real back (physical button or `goBack`). Must be a no-op when there is nothing
   *  left to restore (then the browser leaves `/app` and the app exits). */
  onBack: () => void;
}

export function usePoHistoryNav({ enabled, onBack }: Options): PoHistoryNav {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    const onPop = (): void => {
      onBackRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [enabled]);

  return {
    recordNavigate: () => {
      // Spread Next's internal history.state (its router key) so the App Router does
      // not break on popstate; the URL is unchanged so it stays the same route.
      window.history.pushState({ ...window.history.state, poNav: true }, '');
    },
    goBack: () => {
      window.history.back();
    },
  };
}
