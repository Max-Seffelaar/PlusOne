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
 *
 * Which devices redirect follows decision 14 (N6), not width alone: only a fine
 * pointer at ≥1024px goes to the cockpit; touch at any width (iPad landscape)
 * keeps this outbox door. The variant is `null` through SSR + hydration, so the
 * server HTML is the neutral spinner and `DoorProvider` mounts exactly once, on
 * the real answer — never on a UA guess that a media query later overturns.
 * Latched: once the outbox is up, a later pointer/width change never redirects
 * it away mid-shift.
 *
 * Root pads the top/side safe area like the `/app` shell root (T1
 * `ROOT_SAFE_AREA`): under `viewport-fit=cover` this route otherwise draws
 * under the status bar/notch. The bottom inset stays with the door's own
 * bottom-edge components.
 */
import { type JSX, useEffect, useState } from 'react';
import { PoDoorTab, type DoorOverlay } from '@/components/po/screens/door';
import { Spinner } from '@/components/po/kit';
import { t } from '@/lib/i18n';
import { doorPath } from '@/components/po/routes';
import { useLatchedDoorVariant } from '@/components/po/use-door-variant';
import { ROOT_SAFE_AREA } from '@/components/po/shell-responsive';
import { DoorProvider } from '../DoorProvider';

export function DoorRoute({ eventId }: { eventId: string }): JSX.Element {
  const variant = useLatchedDoorVariant();
  const [tab, setTab] = useState<'deur' | 'taken'>('deur');
  const [overlay, setOverlay] = useState<DoorOverlay>(null);

  useEffect(() => {
    if (variant === 'cockpit') window.location.replace(doorPath({ eventId }));
  }, [variant, eventId]);

  const openGuest = (id: string): void => setOverlay({ kind: 'guest', id });
  const openAdd = (): void => setOverlay({ kind: 'add' });
  const closeOverlay = (): void => setOverlay(null);

  if (variant !== 'outbox') {
    return (
      <div className="flex h-[100dvh] items-center justify-center gap-3 bg-bg text-faint" style={ROOT_SAFE_AREA}>
        <Spinner size={20} />
        <span className="text-[13.5px]">{t.common.loading}</span>
      </div>
    );
  }

  return (
    <DoorProvider eventId={eventId}>
      <div className="flex h-[100dvh] flex-col overflow-hidden bg-bg" style={ROOT_SAFE_AREA}>
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
