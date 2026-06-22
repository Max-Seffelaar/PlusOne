'use client';

// Client boundary for the Event-dag cockpit (S13). The (app) shell is otherwise
// server-rendered; this is the first live-client screen there, so it mounts the
// shared PoLiveProvider (one QueryClient + the server-resolved identity) around the
// cockpit — scoped to this subtree, never the whole layout (which would force every
// server page client). Mirrors how src/app/app/page.tsx wraps the mobile po surface.
//
// First-paint (#2b a): /eventday used to be white until hydration (FCP == LCP ≈
// 3.56s) because the cockpit is fully client-rendered and the initial HTML carried
// no content. The fix has two parts:
//   1. This provider renders a STATIC skeleton on its FIRST render. A 'use client'
//      component still server-renders its initial output, so that skeleton lands in
//      the SSR HTML — FCP now paints the cockpit frame immediately, ≪ LCP. The same
//      skeleton renders on the client's first paint (mounted=false), so there is no
//      hydration mismatch. (Empirically necessary: in Next 15 App Router a
//      `next/dynamic({ ssr:false })` loading fallback is NOT server-rendered, so the
//      skeleton has to be the provider's own initial render, not the dynamic loader.)
//   2. After mount we swap in the cockpit, loaded via next/dynamic(ssr:false) so it
//      lives in its own lazy chunk (trims /eventday First Load JS by ~100 kB). While
//      that chunk is fetching, the dynamic `loading` shows the same skeleton, so the
//      frame stays put until live data arrives — no layout jump (geometry matches).
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { EventDaySkeleton } from './EventDaySkeleton';

const EventDayCockpitGate = dynamic(
  () => import('@/features/po/eventday/EventDayCockpit').then((m) => m.EventDayCockpitGate),
  { loading: () => <EventDaySkeleton />, ssr: false },
);

export function EventDayProvider({ identity }: { identity: PoIdentity }): JSX.Element {
  // false during SSR + the client's first paint → both render the skeleton (no
  // hydration mismatch); flips true after mount to load + show the live cockpit.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <PoLiveProvider identity={identity}>
      {mounted ? <EventDayCockpitGate /> : <EventDaySkeleton />}
    </PoLiveProvider>
  );
}
