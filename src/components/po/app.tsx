'use client';

/**
 * Prototype app shell — mirrors `po-app.jsx`: a single client tree with an
 * in-memory nav stack, auth flow, and shared door state, rendered inside the
 * phone frame. This is the navigable mock; later phases swap the stack for the
 * App Router and the door state for TanStack Query + the offline outbox.
 */
import { useState, type ReactNode } from 'react';
import { contacts, events, guests, venues } from '@/lib/po/data';
import type { PoEvent, Venue } from '@/lib/po/types';
import { PoLiveProvider, usePoEvents } from '@/features/po/PoLiveProvider';
import { PoProvider, type AuthNav, type AuthView, type CheckInEntry, type Nav, type PoApp, type ScreenName, type StackEntry } from './context';
import { PhoneFrame, StatusBar, TabBar, Toast, type TabKey } from './shell';
import { ComingSoonBadge } from './coming-soon';
import { Invite, Login, Mfa, Otp, Welcome } from './screens/auth';
import { EventBeheer, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, Guest, Lijst, QuickAdd, Vaste } from './screens/guests';
import { Deur, Taken } from './screens/door';
import { Aanvragen } from './screens/approvals';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';

const DOOR_USER = 'Joris';

// Screens/tabs already wired to live Supabase data. Anything NOT listed here is
// still mock and gets the "Binnenkort" badge. Add entries as screens are wired.
const WIRED_TABS = new Set<TabKey>(['events']);
const WIRED_SCREENS = new Set<ScreenName>(['eventedit', 'tiers']);

function nowTime(): string {
  return new Date().toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}

function PlusOneAppInner(): JSX.Element {
  // Rendered inside PoLiveProvider, so the nav stack can resolve live events.
  const { events: liveEvents } = usePoEvents();
  // The /app route is auth-protected by middleware and the real OTP flow lives
  // at /login, so by the time this renders the user is signed in — start in the
  // authenticated tab view rather than the prototype's mock welcome/login.
  const [started, setStarted] = useState(true);
  const [authView, setAuthView] = useState<AuthView>('welcome');
  const [authProps, setAuthProps] = useState<{ email?: string }>({});
  const [tab, setTabState] = useState<TabKey>('events');
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [inside, setInside] = useState<Set<number>>(() => new Set(guests.filter((g) => g.status === 'in').map((g) => g.id)));
  const [log, setLog] = useState<Record<number, CheckInEntry>>(() => {
    const o: Record<number, CheckInEntry> = {};
    guests.filter((g) => g.status === 'in').forEach((g) => {
      o[g.id] = { at: g.at ?? '', by: g.inBy ?? DOOR_USER };
    });
    return o;
  });
  const [tasksDone, setTasksDone] = useState<Set<number>>(() => new Set());
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

  const checkIn = (id: number, total: number): void => {
    const g = guests.find((x) => x.id === id);
    setInside((s) => new Set(s).add(id));
    setLog((l) => ({ ...l, [id]: { at: nowTime(), by: DOOR_USER } }));
    setToast((g ? g.name : 'Gast') + (total > 1 ? ' +' + (total - 1) : '') + ' · binnen ✓');
    setTimeout(() => setToast(null), 2400);
  };
  const uncheck = (id: number): void => {
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
  const taskDone = (id: number): boolean => tasksDone.has(id);
  const ackTask = (id: number, val: boolean): void =>
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

  const ev = (id?: string): PoEvent => liveEvents.find((e) => e.id === id) ?? liveEvents[0] ?? events[0];
  const guest = (id?: string) => guests.find((g) => String(g.id) === id) ?? guests[0];

  const top = stack[stack.length - 1];
  const tabRoot = started && stack.length === 0;
  // A screen is "coming soon" until it is wired to live data (see WIRED_* above).
  const comingSoon = started && (top ? !WIRED_SCREENS.has(top.name) : !WIRED_TABS.has(tab));

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
        screen = <Tiers eventId={p.id} />;
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
      default:
        screen = null;
    }
  } else if (tab === 'events') screen = <Events />;
  else if (tab === 'deur') screen = <Deur />;
  else if (tab === 'taken') screen = <Taken />;
  else screen = <Meer />;

  const po: PoApp = { inside, log, checkIn, uncheck, taskDone, ackTask, vast, toggleVast, venue, switchVenue, nav };
  const takenBadge = guests.filter((g) => g.note && !tasksDone.has(g.id)).length;

  return (
    <PoProvider value={po}>
      <PhoneFrame>
        {started && <StatusBar />}
        {comingSoon && <ComingSoonBadge />}
        <div key={key} className="po-screen-anim flex min-h-0 flex-1 flex-col">
          {screen}
        </div>
        {tabRoot && <TabBar tab={tab} setTab={nav.setTab} badges={{ taken: takenBadge }} />}
        {toast && <Toast>{toast}</Toast>}
      </PhoneFrame>
    </PoProvider>
  );
}

export function PlusOneApp(): JSX.Element {
  return (
    <PoLiveProvider>
      <PlusOneAppInner />
    </PoLiveProvider>
  );
}
