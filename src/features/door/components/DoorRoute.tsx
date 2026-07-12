'use client';

/**
 * Standalone `/door/[eventId]` route body (G2 — deur-consolidatie): a thin
 * wrapper that mounts the SAME Door-modus (`PoDoorTab`) the `/app` Door tab
 * uses, instead of a second `DoorShell` tree. Full-bleed — no `PhoneFrame`/
 * mock status bar (M16); this route already only ever runs on a real device
 * (bookmark, Capacitor deep-link, organizer entry), never a desktop preview.
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
  );
}
