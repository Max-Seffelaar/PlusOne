'use client';

// Client boundary for the Event-dag cockpit (S13). The (app) shell is otherwise
// server-rendered; this is the first live-client screen there, so it mounts the
// shared PoLiveProvider (one QueryClient + the server-resolved identity) around the
// cockpit — scoped to this subtree, never the whole layout (which would force every
// server page client). Mirrors how src/app/app/page.tsx wraps the mobile po surface.
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { EventDayCockpitGate } from '@/features/po/eventday/EventDayCockpit';

export function EventDayProvider({ identity }: { identity: PoIdentity }): JSX.Element {
  return (
    <PoLiveProvider identity={identity}>
      <EventDayCockpitGate />
    </PoLiveProvider>
  );
}
