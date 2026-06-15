'use client';

/** Desktop dashboard shell (from `dash.jsx`): sidebar + topbar + view switch.
 *  Desktop surface for Admin/Finance (#6). Mounted at /dashboard.
 *  Wrapped in PoLiveProvider so the sidebar + views read live Supabase data
 *  (session, venue, events, audit, team). */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PoLiveProvider, usePoEvents, useSession } from '@/features/po/PoLiveProvider';
import type { PoEvent } from '@/lib/po/types';
import { Icon, type IconName } from '../icon';
import { Avatar, Label } from '../kit';
import { ComingSoonPill } from '../coming-soon';
import { DBtn } from './kit';
import { EventDetailModal, NewEventModal, NewGuestModal } from './modals';
import { Audit, Events, Home, Stats, Users } from './views';

type View = 'home' | 'events' | 'stats' | 'audit' | 'users';
type Overlay = 'newEvent' | 'newGuest' | null;
const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

// Views still backed by mock data show the "Binnenkort" pill in the topbar.
// Statistieken has no aggregation backend yet (per-kwartier / per-tier) — it
// stays mock; everything else is live.
const MOCK_VIEWS = new Set<View>(['stats']);

const NAV: [View, string, IconName][] = [
  ['home', 'Dashboard', 'grid'],
  ['events', 'Events', 'cal'],
  ['stats', 'Statistieken', 'spark'],
  ['audit', 'Audit log', 'history'],
  ['users', 'Gebruikers', 'users'],
];

/** Venue switcher: dropdown over session.venues; selecting re-scopes the whole
 *  dashboard via setCurrentVenueId (every view keys off currentVenue). */
function VenueSwitcher(): JSX.Element {
  const { session, currentVenue, setCurrentVenueId } = useSession();
  const venues = session?.venues ?? [];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape (no router; this is a local popover).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const multi = venues.length > 1;

  return (
    <div ref={ref} className="relative mb-[18px]">
      <button
        type="button"
        onClick={() => multi && setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left text-text',
          multi ? press : 'cursor-default',
        )}
      >
        <Avatar name={currentVenue?.name ?? '—'} size={30} accent />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[14px] font-bold">{currentVenue?.name ?? 'Geen venue'}</div>
          <div className="text-[11px] text-faint">{currentVenue ? currentVenue.plan : '—'}</div>
        </div>
        {multi && <Icon name="chevD" size={16} className={cn('text-ghost transition-transform', open && 'rotate-180')} />}
      </button>

      {open && multi && (
        <div role="listbox" className="po-screen-anim absolute left-0 right-0 top-[calc(100%+6px)] z-40 overflow-hidden rounded-[12px] border border-line bg-elev2 p-1 shadow-2xl">
          {venues.map((v) => {
            const on = v.id === currentVenue?.id;
            return (
              <button
                key={v.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  setCurrentVenueId(v.id);
                  setOpen(false);
                }}
                className={cn('flex w-full items-center gap-[10px] rounded-[9px] px-[9px] py-[8px] text-left', on ? 'bg-acc-dim' : 'hover:bg-white/[0.04]')}
              >
                <Avatar name={v.name} size={28} accent={on} />
                <div className="min-w-0 flex-1">
                  <div className={cn('overflow-hidden text-ellipsis whitespace-nowrap font-display text-[13.5px] font-bold', on ? 'text-acc' : 'text-text')}>{v.name}</div>
                  <div className="text-[11px] text-faint">
                    {v.plan}
                    {v.roles[0] ? ` · ${v.roles[0]}` : ''}
                  </div>
                </div>
                {on && <Icon name="check2" size={16} stroke="#B5A6FF" sw={2.4} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Sidebar({ view, setView }: { view: View; setView: (v: View) => void }): JSX.Element {
  const { session, currentVenue } = useSession();
  const profile = session?.profile ?? null;
  // Admin/Finance get MFA (CLAUDE.md Auth) — reflect it in the footer badge.
  const venueRoles = currentVenue?.roles ?? [];
  const hasMfaRole = venueRoles.some((r) => r === 'Admin' || r === 'Finance');
  const roleLine = venueRoles[0] ?? 'Lid';

  return (
    <div className="flex h-full w-[250px] shrink-0 flex-col border-r border-line2 bg-bg px-4 py-[22px]">
      <div className="flex items-center gap-[11px] px-2 pb-[22px]">
        <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
        <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">plusone</div>
      </div>
      <VenueSwitcher />
      <Label className="px-[10px] pb-2">Venue</Label>
      <div className="flex flex-col gap-[3px]">
        {NAV.map(([k, l, ic]) => {
          const on = view === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setView(k)}
              className={cn('flex w-full cursor-pointer items-center gap-3 whitespace-nowrap rounded-[12px] border-none px-3 py-[11px] text-left font-display text-[14.5px] font-bold', on ? 'bg-acc-dim text-acc' : 'bg-transparent text-dim transition-colors hover:bg-elev hover:text-text')}
            >
              <Icon name={ic} size={19} sw={on ? 2.2 : 1.9} />
              {l}
            </button>
          );
        })}
      </div>
      <div className="flex-1" />
      <div className="flex items-center gap-[11px] rounded-[12px] border border-line bg-elev p-[10px]">
        <Avatar name={profile?.name ?? '—'} size={34} />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[13.5px] font-bold">{profile?.name ?? 'Niet ingelogd'}</div>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            {hasMfaRole ? (
              <>
                <Icon name="shield" size={11} stroke="#B5A6FF" />
                {roleLine} · MFA
              </>
            ) : (
              roleLine
            )}
          </div>
        </div>
        <button type="button" className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-line bg-transparent text-faint', press)}>
          <Icon name="logout" size={15} />
        </button>
      </div>
    </div>
  );
}

function Topbar({ title, sub, right, mock }: { title: string; sub?: string; right?: ReactNode; mock?: boolean }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-[18px] border-b border-line2 px-[34px] py-[22px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h1 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{title}</h1>
          {/* Only views still backed by mock data carry the pill. */}
          {mock && <ComingSoonPill />}
        </div>
        {sub && <div className="mt-[3px] text-[13.5px] text-faint">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

interface ViewMeta {
  title: string;
  sub: string;
  right: ReactNode;
  Body: () => JSX.Element;
}

/** Resolves the clicked event id (from the Events view) to the live PoEvent so
 *  the detail modal always edits fresh data, then drops it if the row vanishes. */
function EventDetailHost({ eventId, onClose }: { eventId: string; onClose: () => void }): JSX.Element | null {
  const { events } = usePoEvents();
  const event: PoEvent | undefined = events.find((e) => e.id === eventId);
  if (!event) return null;
  return <EventDetailModal event={event} onClose={onClose} />;
}

function DesktopAppInner(): JSX.Element {
  const [view, setView] = useState<View>('home');
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const { currentVenue } = useSession();
  const venueName = currentVenue?.name ?? 'venue';

  const newGuestBtn = (kind: 'ghost' | 'primary' = 'ghost'): JSX.Element => (
    <DBtn kind={kind} icon="plus" onClick={() => setOverlay('newGuest')}>
      Nieuwe gast
    </DBtn>
  );
  const newEventBtn = (icon: IconName = 'cal'): JSX.Element => (
    <DBtn icon={icon} onClick={() => setOverlay('newEvent')}>
      Nieuw event
    </DBtn>
  );

  const meta: Record<View, ViewMeta> = {
    home: {
      title: 'Dashboard',
      sub: `${venueName} · overzicht van deze maand`,
      right: (
        <div className="flex gap-[10px]">
          {newGuestBtn('ghost')}
          {newEventBtn('cal')}
        </div>
      ),
      Body: () => <Home />,
    },
    events: {
      title: 'Events',
      sub: 'Beheer events, tiers en landingpages',
      right: newEventBtn('plus'),
      Body: () => <Events onSelect={setSelectedEventId} />,
    },
    stats: { title: 'Statistieken', sub: `${venueName} · voorbeeldcijfers`, right: <span />, Body: Stats },
    audit: { title: 'Audit log', sub: 'Onveranderlijk logboek — wie deed wat, wanneer', right: <DBtn kind="ghost" icon="dl">Export</DBtn>, Body: Audit },
    users: { title: 'Gebruikers', sub: 'Team en uitnodigingen van deze venue', right: <DBtn icon="plus">Uitnodigen</DBtn>, Body: Users },
  };
  const m = meta[view];
  const Body = m.Body;
  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar view={view} setView={setView} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={m.title} sub={m.sub} right={m.right} mock={MOCK_VIEWS.has(view)} />
        <div key={view} className="po-screen-anim min-h-0 flex-1 overflow-y-auto">
          <Body />
        </div>
      </div>

      {overlay === 'newEvent' && <NewEventModal onClose={() => setOverlay(null)} />}
      {overlay === 'newGuest' && <NewGuestModal onClose={() => setOverlay(null)} />}
      {selectedEventId && <EventDetailHost eventId={selectedEventId} onClose={() => setSelectedEventId(null)} />}
    </div>
  );
}

export function DesktopApp(): JSX.Element {
  return (
    <PoLiveProvider>
      <DesktopAppInner />
    </PoLiveProvider>
  );
}
