'use client';

/**
 * Prototype app shell — mirrors `po-app.jsx`: a single client tree with an
 * in-memory nav stack, auth flow, and shared door state, rendered inside the
 * phone frame. This is the navigable mock; later phases swap the stack for the
 * App Router and the door state for TanStack Query + the offline outbox.
 */
import { useState, type ReactNode } from 'react';
import { contacts, events, guests, venues } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { PoProvider, type AuthNav, type AuthView, type CheckInEntry, type Nav, type PoApp, type ScreenName, type StackEntry } from './context';
import { PhoneFrame, Toast, type TabKey } from './shell';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { Invite, Login, Mfa, Otp, Welcome } from './screens/auth';
import { EventBeheer, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, Guest, Lijst, QuickAdd, Vaste } from './screens/guests';
import { Deur, Taken } from './screens/door';
import { Aanvragen } from './screens/approvals';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';
import { Stats } from './screens/stats';

const DOOR_USER = 'Joris';

function nowTime(): string {
  return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

export function PlusOneApp({
  statsAccess,
  serverHint = false,
  liveVenueName,
}: {
  statsAccess?: { venues: { venueId: string; venueName: string }[] };
  /** Server UA hint for the first-paint viewport switch (corrected by matchMedia). */
  serverHint?: boolean;
  /** Live active-venue name from the session (shell display); mock fallback otherwise. */
  liveVenueName?: string;
}): JSX.Element {
  // /app is gated by real middleware auth, so skip the prototype's mock
  // welcome/login flow and start straight in the authenticated shell.
  const [started, setStarted] = useState(true);
  const [authView, setAuthView] = useState<AuthView>('welcome');
  const [authProps, setAuthProps] = useState<{ email?: string }>({});
  const [tab, setTabState] = useState<TabKey>('events');
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [inside, setInside] = useState<Set<string>>(() => new Set(guests.filter((g) => g.status === 'in').map((g) => g.id)));
  const [log, setLog] = useState<Record<string, CheckInEntry>>(() => {
    const o: Record<string, CheckInEntry> = {};
    guests.filter((g) => g.status === 'in').forEach((g) => {
      o[g.id] = { at: g.at ?? '', by: g.inBy ?? DOOR_USER };
    });
    return o;
  });
  const [tasksDone, setTasksDone] = useState<Set<string>>(() => new Set());
  const [vast, setVast] = useState<Set<string>>(() => new Set(contacts.filter((c) => c.vast).map((c) => c.name)));
  const [venue, setVenueState] = useState<Venue>(() => venues.find((v) => v.current) ?? venues[0]);
  const [toast, setToast] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  const bump = (): void => setKey((k) => k + 1);

  const nav: Nav = {
    push: (name: ScreenName, props = {}) => {
      setStack((s) => [...s, { name, props }]);
      bump();
    },
    back: () => {
      setStack((s) => s.slice(0, -1));
      bump();
    },
    setTab: (t: TabKey) => {
      setTabState(t);
      setStack([]);
      bump();
    },
  };

  const auth: AuthNav = {
    go: (v, props) => {
      setAuthView(v);
      setAuthProps(props ?? {});
      bump();
    },
    start: () => {
      setStarted(true);
      bump();
    },
  };

  const checkIn = (id: string, total: number): void => {
    const g = guests.find((x) => x.id === id);
    setInside((s) => new Set(s).add(id));
    setLog((l) => ({ ...l, [id]: { at: nowTime(), by: DOOR_USER } }));
    setToast((g ? g.name : 'Gast') + (total > 1 ? ' +' + (total - 1) : '') + ' · binnen ✓');
    setTimeout(() => setToast(null), 2400);
  };
  const uncheck = (id: string): void => {
    setInside((s) => {
      const x = new Set(s);
      x.delete(id);
      return x;
    });
    setLog((l) => {
      const o = { ...l };
      delete o[id];
      return o;
    });
    nav.back();
  };
  const taskDone = (id: string): boolean => tasksDone.has(id);
  const ackTask = (id: string, val: boolean): void =>
    setTasksDone((s) => {
      const x = new Set(s);
      if (val) x.add(id);
      else x.delete(id);
      return x;
    });
  const toggleVast = (n: string): void =>
    setVast((s) => {
      const x = new Set(s);
      if (x.has(n)) x.delete(n);
      else x.add(n);
      return x;
    });
  const switchVenue = (v: Venue): void => {
    setVenueState(v);
    setToast('Gewisseld naar ' + v.name);
    setTimeout(() => setToast(null), 2200);
    nav.back();
  };

  const ev = (id?: string) => events.find((e) => e.id === id) ?? events[0];
  const guest = (id?: string) => guests.find((g) => String(g.id) === id) ?? guests[0];

  const top = stack[stack.length - 1];
  const tabRoot = started && stack.length === 0;

  let screen: ReactNode;
  if (!started) {
    if (authView === 'login') screen = <Login auth={auth} />;
    else if (authView === 'otp') screen = <Otp auth={auth} email={authProps.email} />;
    else if (authView === 'mfa') screen = <Mfa auth={auth} />;
    else if (authView === 'invite') screen = <Invite auth={auth} />;
    else screen = <Welcome auth={auth} />;
  } else if (top) {
    const p = top.props;
    switch (top.name) {
      case 'event':
        screen = <EventView ev={ev(p.id)} />;
        break;
      case 'lijst':
        screen = <Lijst ev={ev(p.id)} />;
        break;
      case 'guest':
        screen = <Guest g={guest(p.id)} />;
        break;
      case 'contacten':
        screen = <Contacten />;
        break;
      case 'vaste':
        screen = <Vaste />;
        break;
      case 'rollen':
        screen = <Rollen />;
        break;
      case 'import':
        screen = <Import />;
        break;
      case 'quickadd':
        screen = <QuickAdd />;
        break;
      case 'bulk':
        screen = <BulkPaste />;
        break;
      case 'aanvragen':
        screen = <Aanvragen />;
        break;
      case 'eventedit':
        screen = <EventEdit ev={p.id ? ev(p.id) : undefined} isNew={p.isNew} />;
        break;
      case 'tiers':
        screen = <Tiers />;
        break;
      case 'gebruikers':
        screen = <Gebruikers />;
        break;
      case 'pastevent':
        screen = <PastEvent ev={ev(p.id)} />;
        break;
      case 'venueswitch':
        screen = <VenueSwitch />;
        break;
      case 'venuesettings':
        screen = <VenueSettings venue={venue} />;
        break;
      case 'venuecreate':
        screen = <VenueCreate />;
        break;
      case 'profile':
        screen = <Profile />;
        break;
      case 'billing':
        screen = <Billing />;
        break;
      case 'allowance':
        screen = <Allowance />;
        break;
      case 'eventbeheer':
        screen = <EventBeheer />;
        break;
      case 'stats':
        screen = <Stats />;
        break;
      default:
        screen = null;
    }
  } else if (tab === 'events') screen = <Events />;
  else if (tab === 'deur') screen = <Deur />;
  else if (tab === 'taken') screen = <Taken />;
  else screen = <Meer />;

  const po: PoApp = { inside, log, checkIn, uncheck, taskDone, ackTask, vast, toggleVast, venue, switchVenue, statsVenues: statsAccess?.venues ?? [], nav };
  const takenBadge = guests.filter((g) => g.note && !tasksDone.has(g.id)).length;

  const body = (
    <>
      <div key={key} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );

  // Auth flow (pre-login): keep the centered phone frame.
  if (!started) {
    return (
      <PoProvider value={po}>
        <PhoneFrame>{body}</PhoneFrame>
      </PoProvider>
    );
  }

  // Signed-in: responsive shell — desktop sidebar ≥1024px, mobile tabs below it
  // (S0 nav-shell). Screens are unchanged for now; wired live per S1+.
  const currentKey =
    top?.name === 'stats' ? 'stats' : top?.name === 'gebruikers' ? 'gebruikers' : tab;
  const navItems: ShellNavItem[] = [
    { key: 'events', label: 'Events', icon: 'cal', active: currentKey === 'events', onClick: () => nav.setTab('events') },
    { key: 'deur', label: 'Check-in', icon: 'door', active: currentKey === 'deur', onClick: () => nav.setTab('deur') },
    { key: 'taken', label: 'Taken', icon: 'flag', active: currentKey === 'taken', onClick: () => nav.setTab('taken') },
    { key: 'stats', label: 'Statistieken', icon: 'spark', active: currentKey === 'stats', onClick: () => nav.push('stats') },
    { key: 'gebruikers', label: 'Gebruikers', icon: 'users', active: currentKey === 'gebruikers', onClick: () => nav.push('gebruikers') },
    { key: 'meer', label: 'Meer', icon: 'dots', active: currentKey === 'meer', onClick: () => nav.setTab('meer') },
  ];

  return (
    <PoProvider value={po}>
      <ResponsiveShell
        serverHint={serverHint}
        isTabRoot={tabRoot}
        mobileTab={tab}
        setMobileTab={nav.setTab}
        mobileBadges={{ taken: takenBadge }}
        navItems={navItems}
        venueName={liveVenueName ?? venue.name}
        onOpenVenue={() => nav.push('venueswitch')}
        userName="Beheerder"
        userSub="Admin · MFA"
      >
        {body}
      </ResponsiveShell>
    </PoProvider>
  );
}
