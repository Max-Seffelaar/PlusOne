'use client';

import { useState, useSyncExternalStore } from 'react';
import { hasFinePointer } from '@/lib/platform';

/**
 * Which Door-tab variant this device gets (capacitor-plan decision 14, N6).
 *
 *  - `'outbox'`  — the offline-outbox door (`DoorProvider`, #25).
 *  - `'cockpit'` — the online-only Event-day cockpit (`src/features/po/eventday`).
 *
 * The cockpit is ONLY for a fine pointer (mouse/trackpad) at ≥1024px; anything
 * else — a coarse pointer at any width (iPad landscape at the door), or any
 * viewport under 1024px — gets the outbox. The chrome breakpoint (sidebar vs.
 * bottom tabs, `use-viewport.ts`) is deliberately a different question and
 * stays width-only, so an iPad in landscape shows the sidebar AND the outbox door.
 *
 * Unsure means outbox: `hasFinePointer()` is false without `matchMedia` (an old
 * webview, #37), and the outbox works everywhere while the cockpit is online-only.
 */
export type DoorVariant = 'outbox' | 'cockpit';

// Same breakpoint as `use-viewport.ts` (kept local: several shell tests mock
// that module wholesale, so importing a constant from it would read undefined).
const MOBILE_BREAKPOINT_PX = 1023;
const QUERIES = [`(max-width: ${MOBILE_BREAKPOINT_PX}px)`, '(pointer: fine)'] as const;

export function readDoorVariant(): DoorVariant {
  const narrow =
    typeof window.matchMedia === 'function'
      ? window.matchMedia(QUERIES[0]).matches
      : window.innerWidth <= MOBILE_BREAKPOINT_PX;
  return hasFinePointer() && !narrow ? 'cockpit' : 'outbox';
}

function subscribe(onChange: () => void): () => void {
  // `resize` too, for the same reason as `useViewport`: DevTools device mode and
  // some webviews reflow without firing the media-query `change` event.
  window.addEventListener('resize', onChange);
  const mqls = typeof window.matchMedia === 'function' ? QUERIES.map((q) => window.matchMedia(q)) : [];
  for (const mql of mqls) {
    if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
    else if (typeof mql.addListener === 'function') mql.addListener(onChange);
  }
  return () => {
    window.removeEventListener('resize', onChange);
    for (const mql of mqls) {
      if (typeof mql.removeEventListener === 'function') mql.removeEventListener('change', onChange);
      else if (typeof mql.removeListener === 'function') mql.removeListener(onChange);
    }
  };
}

/** Server/hydration snapshot: unknown. A caller renders a neutral placeholder
 *  for `null` and mounts neither variant, so the first variant it ever mounts
 *  is the real one — no `DoorProvider` built on a UA guess and then torn down. */
const serverSnapshot = (): null => null;

/**
 * The live variant, read synchronously from `matchMedia` on the first CLIENT
 * render (`useSyncExternalStore`), so a client-only tree — the `/app` shell
 * mounts `ssr: false` — never renders a provisional variant. Under SSR (the
 * standalone `/door/[id]` route) it is `null` through hydration and resolves in
 * the re-render React schedules right after.
 */
export function useDoorVariant(): DoorVariant | null {
  return useSyncExternalStore(subscribe, readDoorVariant, serverSnapshot);
}

/**
 * `useDoorVariant`, but once `'outbox'` has been chosen it stays chosen for the
 * lifetime of the calling component. A mounted outbox is never torn down by a
 * later media-query answer — a pointer change (DevTools touch toggle, a
 * trackpad attached to an iPad) or a resize across 1024px while the door is
 * open. Leaving the door tab unmounts the caller and re-evaluates on return.
 * `cockpit → outbox` still switches live: that only MOUNTS a DoorProvider.
 */
export function useLatchedDoorVariant(): DoorVariant | null {
  const live = useDoorVariant();
  const [latched, setLatched] = useState(live === 'outbox');
  // Render-phase latch (React's "adjust state while rendering" pattern): the
  // outbox render and the latch commit together, no effect-lag frame.
  if (live === 'outbox' && !latched) setLatched(true);
  return latched ? 'outbox' : live;
}
