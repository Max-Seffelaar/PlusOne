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
import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Toast } from '../shell';
import { EventRow, toBoardEvents } from '../event-row';
import { useDoor } from '@/features/door/DoorProvider';
import type { PoDoorEvent } from '@/features/po/door-event';
import { usePoGuestRequests, usePoHomeEvents, usePoQuotaRequests } from '@/features/po/hooks';
import { CheckInList } from '@/features/door/components/CheckInList';
import { Taken as DoorTaken } from '@/features/door/components/Taken';
import { GuestDetail } from '@/features/door/components/GuestDetail';
import { AddOnSpot } from '@/features/door/components/AddOnSpot';
import { SyncBar } from '@/features/door/components/SyncBar';

export type DoorOverlay = { kind: 'guest'; id: string } | { kind: 'add' } | null;

// Stable empty override so the picker's board memo doesn't recompute per render.
const NO_LOCK_OVERRIDE: Record<string, boolean> = {};

/**
 * Event picker for the Deur/Taken tabs + the cockpit (S1.3). The door surfaces no
 * longer auto-pick when several events are live/open: the user first chooses which
 * event they are working. Only the CHOSEN event's guests are ever loaded, so a
 * venue with dozens of live events stays cheap. Rendered inside the /app shell,
 * so the menu stays visible while choosing.
 *
 * Renders the SAME EventRow card as the Home board (Max, 7 jul 2026 — one shared
 * component, ../event-row, so a card change shows up on both surfaces) but in
 * pick-only form: no requests/settings/lock buttons and no clickable counts —
 * in this context EVERY click must lead to the door, never to the event
 * settings (Max, 7 jul 2026 follow-up). The `events` prop (door candidates:
 * live/future only) stays the source of truth for which events appear and in
 * what order; the home-events bundle only enriches the rows with counts/dates.
 */
export function DoorEventPicker({
  events,
  onPick,
  title = 'Pick an event',
  sub = 'Which event are you working the door for?',
}: {
  events: PoDoorEvent[];
  onPick: (eventId: string) => void;
  title?: string;
  sub?: string;
}): JSX.Element {
  const eventsQ = usePoHomeEvents();
  const guestReqQ = usePoGuestRequests();
  const quotaReqQ = usePoQuotaRequests();

  const rows = useMemo(() => {
    const board = toBoardEvents(
      eventsQ.data?.events ?? [],
      guestReqQ.data ?? [],
      quotaReqQ.data ?? [],
      NO_LOCK_OVERRIDE,
      Date.now()
    );
    const byId = new Map(board.map((b) => [b.id, b]));
    // Candidate order wins (live first, then soonest — door-event.ts).
    return events.map((e) => byId.get(e.id)).filter((b): b is NonNullable<typeof b> => b != null);
  }, [events, eventsQ.data, guestReqQ.data, quotaReqQ.data]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex-none px-5 pb-3 pt-6">
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.02em] text-text">{title}</h1>
        <p className="mt-1 text-[13px] text-faint">{sub}</p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pb-6">
        {events.length > 0 && rows.length === 0 && eventsQ.isLoading ? (
          <div className="rounded-[20px] border border-line bg-elev p-6 text-center text-[13.5px] text-faint">
            {t.common.loading}
          </div>
        ) : (
          rows.map((e) => (
            <EventRow key={e.id} e={e} showDoor={false} onOpen={() => onPick(e.id)} onDoor={() => onPick(e.id)} />
          ))
        )}
        {events.length === 0 && (
          <div className="rounded-[20px] border border-line bg-elev p-6 text-center text-[13.5px] text-faint">
            No open or live event to work the door for.
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
        Switch
      </button>
    </div>
  );
}

export function PoDoorTab({
  tab,
  onTab,
  overlay,
  openGuest,
  openAdd,
  closeOverlay,
  currentEventName,
  onChangeEvent,
}: {
  tab: 'deur' | 'taken';
  /** Switch the Check-in/Tasks segment (the merged /app Door tab). */
  onTab?: (seg: 'deur' | 'taken') => void;
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
      {!overlay && onTab && (
        <div className="flex flex-none items-center gap-2 px-5 pb-1 pt-2">
          {(['deur', 'taken'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onTab(s)}
              className={cn(
                'rounded-full px-[14px] py-[6px] font-display text-[13px] font-bold transition-[filter] hover:brightness-110',
                tab === s ? 'bg-acc text-on-acc' : 'border border-line bg-elev text-dim',
              )}
            >
              {s === 'deur' ? t.nav.checkin : t.nav.tasks}
            </button>
          ))}
        </div>
      )}
      <div key={navKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );
}
