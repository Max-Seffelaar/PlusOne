'use client';

/** Desktop dashboard shell (from `dash.jsx`): sidebar + topbar + view switch.
 *  Desktop surface for Admin/Finance (#6). Mounted at /dashboard. */
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { invites, team } from '@/lib/po/data';
import { Icon, type IconName } from '../icon';
import { Avatar, Label } from '../kit';
import { ComingSoonPill } from '../coming-soon';
import { DBtn } from './kit';
import { Audit, Events, Home, Stats, Users } from './views';

type View = 'home' | 'events' | 'stats' | 'audit' | 'users';
const press = 'transition-[filter,transform,background,border-color,color] hover:brightness-[1.08] active:scale-[0.985]';

const NAV: [View, string, IconName][] = [
  ['home', 'Dashboard', 'grid'],
  ['events', 'Events', 'cal'],
  ['stats', 'Statistieken', 'spark'],
  ['audit', 'Audit log', 'history'],
  ['users', 'Gebruikers', 'users'],
];

function Sidebar({ view, setView }: { view: View; setView: (v: View) => void }): JSX.Element {
  return (
    <div className="flex h-full w-[250px] shrink-0 flex-col border-r border-line2 bg-bg px-4 py-[22px]">
      <div className="flex items-center gap-[11px] px-2 pb-[22px]">
        <div className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-acc font-display text-[17px] font-extrabold tracking-[-0.03em] text-on-acc">+1</div>
        <div className="font-display text-[19px] font-extrabold tracking-[-0.02em] text-text">plusone</div>
      </div>
      <button type="button" className={cn('mb-[18px] flex w-full items-center gap-[10px] rounded-[12px] border border-line bg-elev p-[10px] text-left text-text', press)}>
        <Avatar name="LOFI" size={30} accent />
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14px] font-bold">LOFI</div>
          <div className="text-[11px] text-faint">Premium · 3 venues</div>
        </div>
        <Icon name="chevD" size={16} className="text-ghost" />
      </button>
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
        <Avatar name="Max Seffelaar" size={34} />
        <div className="min-w-0 flex-1">
          <div className="overflow-hidden text-ellipsis whitespace-nowrap font-display text-[13.5px] font-bold">Max Seffelaar</div>
          <div className="flex items-center gap-1 text-[11px] text-faint">
            <Icon name="shield" size={11} stroke="#B5A6FF" />
            Admin · MFA
          </div>
        </div>
        <button type="button" className={cn('flex h-[30px] w-[30px] items-center justify-center rounded-[9px] border border-line bg-transparent text-faint', press)}>
          <Icon name="logout" size={15} />
        </button>
      </div>
    </div>
  );
}

function Topbar({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }): JSX.Element {
  return (
    <div className="flex shrink-0 items-center gap-[18px] border-b border-line2 px-[34px] py-[22px]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-3">
          <h1 className="m-0 font-display text-[26px] font-extrabold tracking-[-0.02em] text-text">{title}</h1>
          {/* Whole desktop dashboard is still mock — drop this per-view once wired. */}
          <ComingSoonPill />
        </div>
        {sub && <div className="mt-[3px] text-[13.5px] text-faint">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

function EventPick(): JSX.Element {
  return (
    <button type="button" className={cn('inline-flex items-center gap-[9px] rounded-[12px] border border-line bg-elev px-[14px] py-[10px] font-display text-[14px] font-bold text-text', press)}>
      <span className="h-2 w-2 rounded-full bg-acc" />
      FRENZY · vanavond
      <Icon name="chevD" size={15} className="text-ghost" />
    </button>
  );
}

interface ViewMeta {
  title: string;
  sub: string;
  right: ReactNode;
  Body: () => JSX.Element;
}

export function DesktopApp(): JSX.Element {
  const [view, setView] = useState<View>('home');
  const meta: Record<View, ViewMeta> = {
    home: {
      title: 'Dashboard',
      sub: 'LOFI · overzicht van vanavond en deze maand',
      right: (
        <div className="flex gap-[10px]">
          <EventPick />
          <DBtn kind="ghost" icon="plus">
            Nieuwe gast
          </DBtn>
          <DBtn icon="cal">Nieuw event</DBtn>
        </div>
      ),
      Body: Home,
    },
    events: { title: 'Events', sub: 'Beheer events, tiers en landingpages', right: <DBtn icon="plus">Nieuw event</DBtn>, Body: Events },
    stats: { title: 'Statistieken', sub: 'FRENZY · 14 dec 2024', right: <EventPick />, Body: Stats },
    audit: { title: 'Audit log', sub: 'Onveranderlijk logboek — wie deed wat, wanneer', right: <DBtn kind="ghost" icon="dl">Export</DBtn>, Body: Audit },
    users: { title: 'Gebruikers', sub: `${team.length} teamleden · ${invites.length} uitnodigingen open`, right: <DBtn icon="plus">Uitnodigen</DBtn>, Body: Users },
  };
  const m = meta[view];
  const Body = m.Body;
  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar view={view} setView={setView} />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar title={m.title} sub={m.sub} right={m.right} />
        <div key={view} className="po-screen-anim min-h-0 flex-1 overflow-y-auto">
          <Body />
        </div>
      </div>
    </div>
  );
}
