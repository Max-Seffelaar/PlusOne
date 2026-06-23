'use client';

/**
 * Door app shell: the PLUSONE phone frame + iOS status bar (desktop preview
 * parity, full-bleed on a phone), the permanent SyncBar on top, a two-tab nav
 * (Check-in / Taken) and a pushed guest-detail / add overlay. Mirrors the mock
 * `app.tsx` nav pattern, scoped to the door.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Icon, type IconName } from '@/components/po/icon';
import { PhoneFrame, StatusBar, Toast } from '@/components/po/shell';
import { useDoor } from '../DoorProvider';
import { SyncBar } from './SyncBar';
import { CheckInList } from './CheckInList';
import { Taken } from './Taken';
import { GuestDetail } from './GuestDetail';
import { AddOnSpot } from './AddOnSpot';

type Tab = 'checkin' | 'taken';
type Overlay = { kind: 'guest'; id: string } | { kind: 'add' } | null;

const DOOR_TABS: [Tab, string, IconName][] = [
  ['checkin', t.door.tabCheckin, 'user'],
  ['taken', t.door.tabTasks, 'flag'],
];

function DoorTabBar({ tab, setTab, takenBadge }: { tab: Tab; setTab: (t: Tab) => void; takenBadge: number }): JSX.Element {
  return (
    <div
      className="flex flex-none border-t border-line2 bg-[rgba(11,11,13,0.9)] px-[14px] pt-2 backdrop-blur-[12px]"
      style={{ paddingBottom: 'calc(14px + env(safe-area-inset-bottom))' }}
    >
      {DOOR_TABS.map(([k, l, ic]) => {
        const on = tab === k;
        const badge = k === 'taken' ? takenBadge : 0;
        return (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              'flex flex-1 cursor-pointer flex-col items-center gap-1 border-none bg-transparent py-1 transition-[filter] hover:brightness-[1.07]',
              on ? 'text-acc' : 'text-faint',
            )}
          >
            <span className="relative">
              <Icon name={ic} size={22} sw={on ? 2.2 : 1.9} />
              {badge > 0 && (
                <span className="absolute -right-[9px] -top-[5px] flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg bg-acc px-1 font-display text-[10px] font-extrabold text-on-acc">
                  {badge}
                </span>
              )}
            </span>
            <span className="font-body text-[11px] font-bold">{l}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DoorShell(): JSX.Element {
  const { tasks, toast } = useDoor();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('checkin');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const takenBadge = tasks.filter((t) => !t.done).length;

  const openGuest = (id: string): void => setOverlay({ kind: 'guest', id });
  const closeOverlay = (): void => setOverlay(null);

  let screen: JSX.Element;
  if (overlay?.kind === 'guest') screen = <GuestDetail guestId={overlay.id} onBack={closeOverlay} />;
  else if (overlay?.kind === 'add') screen = <AddOnSpot onBack={closeOverlay} />;
  else if (tab === 'checkin') screen = <CheckInList onOpenGuest={openGuest} onAdd={() => setOverlay({ kind: 'add' })} />;
  else screen = <Taken onOpenGuest={openGuest} />;

  const navKey = overlay ? overlay.kind + ('id' in overlay ? overlay.id : '') : tab;

  return (
    <PhoneFrame>
      <StatusBar />
      {/* Way back out of the focused door PWA (e.g. when opened from the cockpit's
          "Open deur-app") so it isn't a dead-end. Overlays carry their own back. */}
      {!overlay && (
        <div className="flex flex-none items-center px-3 pt-1">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={t.door.back}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 font-body text-[13px] font-semibold text-faint transition-[filter] hover:brightness-[1.3]"
          >
            <Icon name="chev" size={17} className="rotate-180" />
            {t.door.back}
          </button>
        </div>
      )}
      <SyncBar />
      <div key={navKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {!overlay && <DoorTabBar tab={tab} setTab={setTab} takenBadge={takenBadge} />}
      {toast && <Toast>{toast}</Toast>}
    </PhoneFrame>
  );
}
