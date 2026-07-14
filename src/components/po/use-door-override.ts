'use client';

/**
 * Door sub-state override (G1 fresh-review fix, extracted from app.tsx so the
 * clearing rules are unit-testable — see `use-door-override.test.ts`).
 *
 * `router.push`/`replace` on the fully-dynamic `/app` catch-all hits the server
 * for a fresh RSC payload on ANY search-param change (Next keys cached page data
 * by the full search string; the aliasing optimization needs a `loading.tsx`
 * this route doesn't have), which breaks the door's offline invariant (#25) for
 * every overlay open/close and segment switch. So door sub-state (guest/add
 * overlay, Deur↔Taken segment, event override) is driven through raw
 * `window.history.pushState`/`replaceState` instead — no server round-trip — and
 * this local override SHADOWS the URL-derived door fields, because Next's
 * `usePathname`/`useSearchParams` do NOT reactively track raw History API calls:
 * they stay frozen at the last genuine router navigation and only resync on a
 * real router-driven nav or a browser back/forward popstate.
 *
 * The override must be dropped again the moment the URL becomes authoritative, or
 * it would mask a real navigation. Two triggers do that:
 */
import { useEffect, useState } from 'react';
import type { DoorSeg, DoorOverlayState } from './routes';

export interface DoorOverrideState {
  seg: DoorSeg;
  eventId: string | null;
  overlay: DoorOverlayState;
}

export function useDoorOverride(
  pathname: string,
  searchParamsStr: string,
): readonly [DoorOverrideState | null, (next: DoorOverrideState | null) => void] {
  const [doorOverride, setDoorOverride] = useState<DoorOverrideState | null>(null);

  // 1. Next's own hooks reported a change — a genuine router-driven navigation
  //    (Next also resyncs these on a popstate, but not always: see #2).
  useEffect(() => {
    setDoorOverride(null);
  }, [pathname, searchParamsStr]);

  // 2. Any browser back/forward, directly. A popstate can land on a URL whose
  //    search string is IDENTICAL to the one Next last tracked, so effect #1
  //    never re-runs: the door is entered via `?event=A`, which freezes
  //    `useSearchParams` at `event=A`; the raw-history sub-nav (switch → picker →
  //    re-pick → open overlay) never changes Next's tracked value; and popping
  //    the overlay returns to `?event=A` — the same frozen string. Without this
  //    listener the stale overlay override would survive that pop, so the overlay
  //    lingers on screen and the NEXT Back over-pops straight PAST the check-in
  //    list (bug 86ey9tq62). A popstate always means the browser URL just won, so
  //    drop the shadow here regardless of whether Next's hooks changed — the
  //    URL-derived door state (now authoritative) takes over.
  useEffect(() => {
    const onPopState = (): void => setDoorOverride(null);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return [doorOverride, setDoorOverride] as const;
}
