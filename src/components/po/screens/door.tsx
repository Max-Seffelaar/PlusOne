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
import { cn } from '@/lib/utils';
import { Toast } from '../shell';
import { useDoor } from '@/features/door/DoorProvider';
import type { PoDoorEvent } from '@/features/po/door-event';
import { CheckInList } from '@/features/door/components/CheckInList';
import { Taken as DoorTaken } from '@/features/door/components/Taken';
import { GuestDetail } from '@/features/door/components/GuestDetail';
import { AddOnSpot } from '@/features/door/components/AddOnSpot';
import { SyncBar } from '@/features/door/components/SyncBar';

export type DoorOverlay = { kind: 'guest'; id: string } | { kind: 'add' } | null;

/**
 * Event switcher for the Deur/Taken tabs (S1.3). The tabs resolve a venue-wide
 * "current" event automatically; when several events are live/open this strip lets
 * the doorhost deliberately pick which one they are working — instead of the
 * automatic guess landing on the wrong night. Hidden when there is only one
 * candidate (nothing to choose). Only shows on the tab roots, not inside an overlay.
 */
function DoorEventSwitcher({
  events,
  currentId,
  onSelect,
}: {
  events: PoDoorEvent[];
  currentId: string;
  onSelect: (eventId: string) => void;
}): JSX.Element | null {
  if (events.length < 2) return null;
  return (
    <div className="flex flex-none items-center gap-2 overflow-x-auto border-b border-line2 px-5 py-2.5">
      <span className="shrink-0 font-body text-[11px] font-bold uppercase tracking-[0.06em] text-faint">Event</span>
      {events.map((e) => {
        const on = e.id === currentId;
        return (
          <button
            key={e.id}
            type="button"
            onClick={() => onSelect(e.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 font-display text-[12.5px] font-bold transition-[filter] hover:brightness-[1.07]',
              on ? 'border-transparent bg-text text-bg' : 'border-line bg-transparent text-dim',
            )}
          >
            {e.status === 'live' && <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-bg' : 'bg-acc')} />}
            {e.name}
          </button>
        );
      })}
    </div>
  );
}

export function PoDoorTab({
  tab,
  overlay,
  openGuest,
  openAdd,
  closeOverlay,
  candidates = [],
  currentEventId,
  onSelectEvent,
}: {
  tab: 'deur' | 'taken';
  overlay: DoorOverlay;
  openGuest: (id: string) => void;
  openAdd: () => void;
  closeOverlay: () => void;
  /** Non-closed events of the venue, for the in-tab switcher (S1.3). */
  candidates?: PoDoorEvent[];
  currentEventId?: string;
  onSelectEvent?: (eventId: string) => void;
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
      {!overlay && onSelectEvent && currentEventId && (
        <DoorEventSwitcher events={candidates} currentId={currentEventId} onSelect={onSelectEvent} />
      )}
      <div key={navKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
