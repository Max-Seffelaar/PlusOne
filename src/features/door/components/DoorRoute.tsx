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
 *
 * A HARD navigation (`window.location`), not `router.replace`: `/app` is a
 * completely different route tree with its own (heavier) layout — nothing to
 * preserve by keeping it client-side-soft, and a hard nav gives the browser's
 * own loading affordance (tab spinner) instead of a silent blank screen while
 * the other layout's data resolves (retest 13/7 — a slow /app compile/data
 * fetch read as "broken" with nothing on screen in the meantime).
 */
import { type JSX, useEffect, useState } from 'react';
import { PoDoorTab, type DoorOverlay } from '@/components/po/screens/door';
import { Spinner } from '@/components/po/kit';
import { t } from '@/lib/i18n';
import { doorPath } from '@/components/po/routes';
import { useViewport } from '@/components/po/use-viewport';
import { DoorProvider } from '../DoorProvider';

export function DoorRoute({ eventId, serverHint }: { eventId: string; serverHint?: boolean }): JSX.Element {
  const isMobile = useViewport(serverHint);
  const [tab, setTab] = useState<'deur' | 'taken'>('deur');
  const [overlay, setOverlay] = useState<DoorOverlay>(null);

  useEffect(() => {
    if (!isMobile) window.location.replace(doorPath({ eventId }));
  }, [isMobile, eventId]);

  const openGuest = (id: string): void => setOverlay({ kind: 'guest', id });
  const openAdd = (): void => setOverlay({ kind: 'add' });
  const closeOverlay = (): void => setOverlay(null);

  if (!isMobile) {
    return (
      <div className="flex h-[100dvh] items-center justify-center gap-3 bg-bg text-faint">
        <Spinner size={20} />
        <span className="text-[13.5px]">{t.common.loading}</span>
      </div>
    );
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
