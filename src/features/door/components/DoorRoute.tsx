'use client';

/**
 * Standalone `/door/[eventId]` route body (G2 — deur-consolidatie): a thin
 * wrapper that mounts the SAME Door-modus (`PoDoorTab`) the `/app` Door tab
 * uses, instead of a second `DoorShell` tree. No `PhoneFrame`/mock status bar
 * (M16) — but this route IS opened from real desktop browsers too (an
 * organizer or admin checking the door from a laptop, not just a bookmarked
 * door device), so it still clamps to a phone-card width and centers on wide
 * viewports (retest 13/7) — just without the old bezel/branding/fake "9:41".
 *
 * Owns the tab/overlay state `DoorShell` used to own — this route has no
 * `/app` shell to source it from. `PoDoorTab` already self-wraps in
 * `DoorErrorBoundary` and renders `SyncBar`.
 */
import { useState } from 'react';
import { PoDoorTab, type DoorOverlay } from '@/components/po/screens/door';

export function DoorRoute(): JSX.Element {
  const [tab, setTab] = useState<'deur' | 'taken'>('deur');
  const [overlay, setOverlay] = useState<DoorOverlay>(null);

  const openGuest = (id: string): void => setOverlay({ kind: 'guest', id });
  const openAdd = (): void => setOverlay({ kind: 'add' });
  const closeOverlay = (): void => setOverlay(null);

  return (
    <div className="flex h-[100dvh] justify-center bg-bg lg:bg-elev">
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-bg lg:max-w-[430px] lg:border-x lg:border-line2">
        <PoDoorTab
          tab={tab}
          onTab={setTab}
          overlay={overlay}
          openGuest={openGuest}
          openAdd={openAdd}
          closeOverlay={closeOverlay}
        />
      </div>
    </div>
  );
}
