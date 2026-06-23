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
 * Event picker for the Deur/Taken tabs + the cockpit (S1.3). The door surfaces no
 * longer auto-pick when several events are live/open: the user first chooses which
 * event they are working. Only the CHOSEN event's guests are ever loaded (this list
 * carries none), so a venue with dozens of live events stays cheap. Rendered inside
 * the /app shell, so the bottom-tab menu stays visible while choosing.
 */
export function DoorEventPicker({
  events,
  onPick,
  title = 'Kies het event',
  sub = 'Aan welk event sta je aan de deur?',
}: {
  events: PoDoorEvent[];
  onPick: (eventId: string) => void;
  title?: string;
  sub?: string;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-5 pb-3 pt-6">
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-text">{title}</h1>
        <p className="mt-1 text-[13px] text-faint">{sub}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-[10px] overflow-y-auto px-5 pb-6">
        {events.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onPick(e.id)}
            className="flex items-center gap-[13px] rounded-[16px] border border-line bg-elev p-[15px] text-left transition-[border-color,transform] hover:border-white/[0.24] active:scale-[0.99]"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[16px] font-bold text-text">{e.name}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-faint">
                {e.status === 'live' && <span className="h-1.5 w-1.5 rounded-full bg-acc" />}
                {e.venueName}
                {e.status === 'live' ? ' · live' : ' · open'}
              </span>
            </span>
            <span className="rounded-full bg-acc px-[14px] py-[8px] font-display text-[13px] font-bold text-on-acc">Open</span>
          </button>
        ))}
        {events.length === 0 && (
          <div className="rounded-[16px] border border-line bg-elev p-6 text-center text-[13.5px] text-faint">
            Geen open of live event om aan de deur te doen.
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact "which event" bar above the door once one is chosen, with a "Wissel"
 *  back to the picker. Only rendered when there is more than one candidate. */
function DoorEventBar({ name, onChange }: { name: string; onChange: () => void }): JSX.Element {
  return (
    <div className="flex flex-none items-center gap-2 border-b border-line2 px-5 py-2.5">
      <span className="shrink-0 font-body text-[11px] font-bold uppercase tracking-[0.06em] text-faint">Event</span>
      <span className="min-w-0 flex-1 truncate font-display text-[13.5px] font-bold text-text">{name}</span>
      <button
        type="button"
        onClick={onChange}
        className={cn(
          'shrink-0 rounded-full border border-line px-3 py-1.5 font-display text-[12px] font-bold text-dim',
          'transition-[filter] hover:brightness-[1.12]',
        )}
      >
        Wissel
      </button>
    </div>
  );
}

export function PoDoorTab({
  tab,
  overlay,
  openGuest,
  openAdd,
  closeOverlay,
  currentEventName,
  onChangeEvent,
}: {
  tab: 'deur' | 'taken';
  overlay: DoorOverlay;
  openGuest: (id: string) => void;
  openAdd: () => void;
  closeOverlay: () => void;
  /** Chosen event's name + a "Wissel" handler — a compact bar shown when there is
   *  more than one candidate, so the doorhost can switch back to the picker (S1.3). */
  currentEventName?: string;
  onChangeEvent?: () => void;
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
      {!overlay && onChangeEvent && currentEventName && (
        <DoorEventBar name={currentEventName} onChange={onChangeEvent} />
      )}
      <div key={navKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
