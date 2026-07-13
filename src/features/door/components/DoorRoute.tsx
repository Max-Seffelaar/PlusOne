'use client';

/**
 * Standalone `/door/[eventId]` route body (G2 — deur-consolidatie). No
 * `PhoneFrame`/mock status bar (M16).
 *
 * Desktop split (retest 13/7): a laptop/desktop visitor doesn't want the
 * phone-shaped Door-modus with no nav — they want the FULL `/app` shell (so
 * they can also reach guests/events/settings), landed on its Deur tab for
 * this event. So ≥1024px redirects to `doorPath({eventId})` instead of
 * mounting a second cockpit tree here; `/app`'s Deur tab already IS the
 * desktop cockpit. Mobile stays exactly as before — the focused, chrome-free
 * Door-modus a bookmarked door device wants, no redirect.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PoDoorTab, type DoorOverlay } from '@/components/po/screens/door';
import { doorPath } from '@/components/po/routes';
import { useViewport } from '@/components/po/use-viewport';
import { DoorProvider } from '../DoorProvider';

export function DoorRoute({ eventId, serverHint }: { eventId: string; serverHint?: boolean }): JSX.Element {
  const isMobile = useViewport(serverHint);
  const router = useRouter();
  const [tab, setTab] = useState<'deur' | 'taken'>('deur');
  const [overlay, setOverlay] = useState<DoorOverlay>(null);

  useEffect(() => {
    if (!isMobile) router.replace(doorPath({ eventId }));
  }, [isMobile, eventId, router]);

  const openGuest = (id: string): void => setOverlay({ kind: 'guest', id });
  const openAdd = (): void => setOverlay({ kind: 'add' });
  const closeOverlay = (): void => setOverlay(null);

  if (!isMobile) {
    // Mid-redirect — nothing meaningful to show for the instant before the
    // effect above fires.
    return <div className="h-[100dvh] bg-bg" />;
  }

  return (
    <DoorProvider eventId={eventId}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg">
        <PoDoorTab
          tab={tab}
          onTab={setTab}
          overlay={overlay}
          openGuest={openGuest}
          openAdd={openAdd}
          closeOverlay={closeOverlay}
        />
      </div>
    </DoorProvider>
  );
}
