'use client';

/**
 * Mobile Deur + Taken tabs (po surface), wired to the SAME DoorProvider as the
 * /door/[eventId] route — so check-in / uncheck (soft-void) / top-up / refuse /
 * add-on-spot and note-ack all go through the offline outbox + realtime, never a
 * second in-memory door state (decisions #11/#25/#39, CLAUDE.md "never duplicate
 * the door's offline outbox").
 *
 * We RENDER the existing door components rather than re-implementing them, so the
 * two surfaces can't drift. The guest-checkin + add-on-spot are a local overlay
 * whose open/closed state is lifted to the app shell (so the mobile tab bar hides
 * behind a full-screen detail), NOT the po nav stack — the door owns its own
 * navigation inside its provider.
 */
import { Toast } from '../shell';
import { useDoor } from '@/features/door/DoorProvider';
import { CheckInList } from '@/features/door/components/CheckInList';
import { Taken as DoorTaken } from '@/features/door/components/Taken';
import { GuestDetail } from '@/features/door/components/GuestDetail';
import { AddOnSpot } from '@/features/door/components/AddOnSpot';
import { SyncBar } from '@/features/door/components/SyncBar';

export type DoorOverlay = { kind: 'guest'; id: string } | { kind: 'add' } | null;

export function PoDoorTab({
  tab,
  overlay,
  openGuest,
  openAdd,
  closeOverlay,
}: {
  tab: 'deur' | 'taken';
  overlay: DoorOverlay;
  openGuest: (id: string) => void;
  openAdd: () => void;
  closeOverlay: () => void;
}): JSX.Element {
  const { toast } = useDoor();

  let screen: JSX.Element;
  if (overlay?.kind === 'guest') screen = <GuestDetail guestId={overlay.id} onBack={closeOverlay} />;
  else if (overlay?.kind === 'add') screen = <AddOnSpot onBack={closeOverlay} />;
  else if (tab === 'deur') screen = <CheckInList onOpenGuest={openGuest} onAdd={openAdd} />;
  else screen = <DoorTaken onOpenGuest={openGuest} />;

  const navKey = overlay ? overlay.kind + ('id' in overlay ? overlay.id : '') : tab;

  return (
    <>
      <SyncBar />
      <div key={navKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
