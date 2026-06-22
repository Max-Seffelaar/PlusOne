'use client';

/**
 * po app shell — a single client tree with an in-memory nav stack + auth flow,
 * rendered through the responsive shell. Events / Gastenlijst / adresboek read
 * live Supabase data; the Deur/Taken tabs mount the real DoorProvider (offline
 * outbox + realtime), so there is no in-memory door state here anymore.
 */
import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { venues } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { usePoDoorEvent, usePoEvents, usePoGuests } from '@/features/po/hooks';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canWorkDoor } from '@/features/auth/roles';
import { setActiveVenue } from '@/features/venues/actions';
import { DoorProvider } from '@/features/door/DoorProvider';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import {
  PoProvider,
  loadNavState,
  saveNavState,
  type AuthNav,
  type AuthView,
  type Nav,
  type PoApp,
  type PoVenueOption,
  type ScreenName,
  type StackEntry,
} from './context';
import { PhoneFrame, Toast, type TabKey } from './shell';
import { Top } from './kit';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { Invite, Login, Mfa, Otp, Welcome } from './screens/auth';
import { EventBeheer, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, Guest, Lijst, QuickAdd, Vaste } from './screens/guests';
import { PoDoorTab, type DoorOverlay } from './screens/door';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';
import { Home } from './screens/home';

/**
 * Code-split (#2a): the heavy/rare screens below each live in their own module
 * that is only ever reached here, deep in the nav stack — so they have no place
 * on the door-only / common path. Loading them lazily via `next/dynamic` keeps
 * the `/app` First Load JS lean: a doorhost (Check-in/Taken only) never pulls the
 * Statistieken / Audit / Admin-sessies / Aanvragen chunks. Each module is
 * self-contained (it exports nothing the common path imports), so the chunk is
 * cleanly evicted from the shared bundle. `ssr: false` is safe — these only
 * mount after client-side navigation inside the already-client app shell.
 *
 * NOTE: Billing/Import are intentionally NOT split — they share `settings.tsx`
 * with `Meer` (an always-present hub), so the module stays in the common chunk
 * regardless; a dynamic import there would add a Suspense boundary for no size win.
 */
const ScreenLoading = (): JSX.Element => (
  <div className="flex h-full flex-1 items-center justify-center text-[14px] text-faint">Even laden…</div>
);
const Stats = dynamic(() => import('./screens/stats').then((m) => m.Stats), {
  loading: ScreenLoading,
  ssr: false,
});
const AuditLog = dynamic(() => import('./screens/audit').then((m) => m.AuditLog), {
  loading: ScreenLoading,
  ssr: false,
});
const AdminSessions = dynamic(() => import('./screens/admin-sessions').then((m) => m.AdminSessions), {
  loading: ScreenLoading,
  ssr: false,
});
const Aanvragen = dynamic(() => import('./screens/approvals').then((m) => m.Aanvragen), {
  loading: ScreenLoading,
  ssr: false,
});

/** Desktop content-column width per active screen. Most screens keep the
 *  comfortable reading column (640); data-dense dashboards/tables/charts and the
 *  detail/dashboard screens with a real wide layout opt into the full width
 *  (S3.3). Forms (eventedit/tiers/settings/profile/billing/quickadd/bulk/import)
 *  deliberately stay narrow — they read better in one column. (Mobile is
 *  full-bleed regardless of this.) */
const WIDE_DESKTOP: Record<string, string> = {
  start: 'max-w-[1080px]',
  events: 'max-w-[1080px]',
  lijst: 'max-w-[1080px]',
  stats: 'max-w-[1080px]',
  audit: 'max-w-[1080px]',
  gebruikers: 'max-w-[1080px]',
  // Detail / dashboard screens with a two-column or grid desktop layout (S3.3).
  event: 'max-w-[1080px]',
  pastevent: 'max-w-[1080px]',
  eventbeheer: 'max-w-[1080px]',
  aanvragen: 'max-w-[1080px]',
};

/** Shown while a pushed event/guest screen waits for its live row to load. */
function Loading({ onBack }: { onBack: () => void }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top onBack={onBack} title="Laden…" />
      <div className="flex flex-1 items-center justify-center text-[14px] text-faint">Even laden…</div>
    </div>
  );
}

/** Door/Taken tab placeholder while the venue's door event resolves, or when
 *  there is none (no upcoming/live event) so DoorProvider can't be mounted. */
function DoorTabState({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Top big title={title} />
      <div className="flex flex-1 items-center justify-center px-8 text-center text-[14px] text-faint">{text}</div>
    </div>
  );
}

export function PlusOneApp({
  statsAccess,
  serverHint = false,
  liveVenueName,
  liveUserName,
  liveUserSub,
  myVenues = [],
  activeVenueId = null,
}: {
  statsAccess?: { venues: { venueId: string; venueName: string }[] };
  /** Server UA hint for the first-paint viewport switch (corrected by matchMedia). */
  serverHint?: boolean;
  /** Live active-venue name from the session (shell display); mock fallback otherwise. */
  liveVenueName?: string;
  /** Live signed-in user's display name (shell footer). */
  liveUserName?: string;
  /** Live role label (+ MFA) for the shell footer. */
  liveUserSub?: string;
  /** The caller's live memberships — the switchable venues (S3.1). */
  myVenues?: PoVenueOption[];
  /** The live active venue id (from the session cookie). */
  activeVenueId?: string | null;
}): JSX.Element {
  const router = useRouter();
  // /app is gated by real middleware auth, so skip the prototype's mock
  // welcome/login flow and start straight in the authenticated shell.
  const [started, setStarted] = useState(true);
  const [authView, setAuthView] = useState<AuthView>('welcome');
  const [authProps, setAuthProps] = useState<{ email?: string }>({});
  const [tab, setTabState] = useState<TabKey>('start');
  const [stack, setStack] = useState<StackEntry[]>([]);
  // Door check-in overlay (guest detail / add-on-spot) for the Deur/Taken tabs.
  // The state lives here (not inside DoorProvider) so the mobile tab bar can hide
  // behind a full-screen door detail (isTabRoot below); the door components that
  // read it render inside the provider, via <PoDoorTab>.
  const [doorOverlay, setDoorOverlay] = useState<DoorOverlay>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [key, setKey] = useState(0);
  const [switching, setSwitching] = useState(false);

  // The active venue as a mock-shaped Venue (live id + name + roles), so screens
  // that still read `po.venue` get the real active venue; the mock is only a
  // last resort for a venue-less session (shouldn't happen post-onboarding).
  const activeOption = myVenues.find((v) => v.id === activeVenueId) ?? null;
  const venue: Venue = activeOption
    ? { id: activeOption.id, name: liveVenueName ?? activeOption.name, city: '', plan: '', roles: activeOption.roles, events: 0, current: true }
    : (venues.find((v) => v.current) ?? venues[0]);

  // Restore the tab + nav stack after a browser refresh (S3.2). Runs once on
  // mount (never during SSR), so there's no hydration mismatch; the persisted
  // screen replaces the default Start on the next frame. `navHydrated` gates the
  // writer below so the initial {start, []} can't clobber the saved value before
  // this read runs.
  const [navHydrated, setNavHydrated] = useState(false);
  useEffect(() => {
    const saved = loadNavState();
    if (saved) {
      setTabState(saved.tab);
      setStack(saved.stack);
    }
    setNavHydrated(true);
  }, []);
  useEffect(() => {
    if (!navHydrated) return;
    saveNavState({ tab, stack });
  }, [navHydrated, tab, stack]);

  const bump = (): void => setKey((k) => k + 1);

  // Live data for the /app surface (STAP 3.4 + the events-live id-passing slice
  // of 3.3): the Events tab, event detail, and Gastenlijst resolve real Supabase
  // rows instead of the in-memory mock. The Deur/Taken tabs are wired live too
  // (STAP 3.5) — they mount the real DoorProvider for the venue's current event.
  const top = stack[stack.length - 1];
  const { roles } = usePoIdentity();
  // Only door roles (admin / doorhost) see the Deur/Taken tabs — staff/finance/
  // user_manager can't read check_ins/refusals (#17), so the door would look
  // empty/"mock" for them. Organizers use /door/[eventId] directly.
  const showDoor = canWorkDoor(roles);
  const { data: liveEvents } = usePoEvents();
  const events = liveEvents ?? [];
  // The venue's current door event (live → next → recent); drives DoorProvider.
  const doorEventQuery = usePoDoorEvent();
  // The event in context carries its id (lijst/event/pastevent via `id`, the
  // guest detail via `eventId`), so the detail resolves a real guest from the
  // same cached list the Gastenlijst reads.
  const eventIdInContext =
    top?.name === 'guest'
      ? top.props.eventId ?? ''
      : top && (top.name === 'lijst' || top.name === 'event' || top.name === 'pastevent')
        ? top.props.id ?? ''
        : '';
  const { data: liveGuests } = usePoGuests(eventIdInContext);

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
      setDoorOverlay(null);
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

  // Door-overlay navigation (within the Deur/Taken tabs, scoped to DoorProvider).
  const openGuest = (id: string): void => setDoorOverlay({ kind: 'guest', id });
  const openAdd = (): void => setDoorOverlay({ kind: 'add' });
  const closeOverlay = (): void => setDoorOverlay(null);

  const switchVenue = (venueId: string): void => {
    if (switching || venueId === activeVenueId) return;
    const target = myVenues.find((v) => v.id === venueId);
    setSwitching(true);
    void setActiveVenue(venueId)
      .then((res) => {
        if (!res.ok) {
          setToast('Wisselen mislukt — probeer opnieuw.');
          setTimeout(() => setToast(null), 2600);
          return;
        }
        // Reset to a clean home so we never show the previous venue's pushed
        // detail screens, then re-run the server component: it re-resolves
        // identity from the new cookie and every venue-scoped query refetches.
        nav.setTab('start');
        setToast('Gewisseld naar ' + (target?.name ?? 'venue'));
        setTimeout(() => setToast(null), 2200);
        router.refresh();
      })
      .catch(() => {
        setToast('Wisselen mislukt — probeer opnieuw.');
        setTimeout(() => setToast(null), 2600);
      })
      .finally(() => setSwitching(false));
  };

  const ev = (id?: string) => events.find((e) => e.id === id);
  const guest = (id?: string) => (liveGuests ?? []).find((g) => g.id === id);

  // The Deur/Taken tabs render inside DoorProvider (door branch below). A door
  // overlay (guest detail / add) is treated like a pushed screen: it hides the
  // mobile tab bar so the detail goes full-screen with its own action bar.
  const isDoorTab = showDoor && started && stack.length === 0 && (tab === 'deur' || tab === 'taken');
  const doorOverlayOpen = isDoorTab && doorOverlay !== null;
  const tabRoot = started && stack.length === 0 && !doorOverlayOpen;

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
        screen = <EventView id={p.id} />;
        break;
      case 'lijst': {
        const e = ev(p.id);
        screen = e ? <Lijst ev={e} /> : <Loading onBack={nav.back} />;
        break;
      }
      case 'guest': {
        const g = guest(p.id);
        screen = g ? <Guest g={g} /> : <Loading onBack={nav.back} />;
        break;
      }
      case 'contacten':
        screen = <Contacten eventId={p.id} />;
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
        screen = <QuickAdd eventId={p.id} />;
        break;
      case 'bulk':
        screen = <BulkPaste eventId={p.id} />;
        break;
      case 'aanvragen':
        screen = <Aanvragen eventId={p.id} />;
        break;
      case 'eventedit':
        screen = <EventEdit id={p.id} isNew={p.isNew} />;
        break;
      case 'tiers':
        screen = <Tiers eventId={p.id} />;
        break;
      case 'gebruikers':
        screen = <Gebruikers />;
        break;
      case 'pastevent':
        screen = <PastEvent id={p.id} />;
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
      case 'audit':
        screen = <AuditLog eventId={p.id} />;
        break;
      case 'adminsessions':
        screen = <AdminSessions />;
        break;
      default:
        screen = null;
    }
  } else if (tab === 'start') screen = <Home />;
  else if (tab === 'events') screen = <Events />;
  else if (tab === 'meer') screen = <Meer />;
  // 'deur' / 'taken' render via the door branch below when allowed; for a
  // non-door role (showDoor=false) the tabs are hidden, so fall back to the home.
  else screen = <Home />;

  const po: PoApp = { venue, myVenues, activeVenueId, switchVenue, switching, statsVenues: statsAccess?.venues ?? [], nav };

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
    { key: 'start', label: 'Start', icon: 'grid', active: currentKey === 'start', onClick: () => nav.setTab('start') },
    { key: 'events', label: 'Events', icon: 'cal', active: currentKey === 'events', onClick: () => nav.setTab('events') },
    ...(showDoor
      ? ([
          { key: 'deur', label: 'Check-in', icon: 'door', active: currentKey === 'deur', onClick: () => nav.setTab('deur') },
          { key: 'taken', label: 'Taken', icon: 'flag', active: currentKey === 'taken', onClick: () => nav.setTab('taken') },
        ] as ShellNavItem[])
      : []),
    { key: 'stats', label: 'Statistieken', icon: 'spark', active: currentKey === 'stats', onClick: () => nav.push('stats') },
    { key: 'gebruikers', label: 'Gebruikers', icon: 'users', active: currentKey === 'gebruikers', onClick: () => nav.push('gebruikers') },
    { key: 'meer', label: 'Meer', icon: 'dots', active: currentKey === 'meer', onClick: () => nav.setTab('meer') },
  ];
  // Mobile bottom tabs — non-door roles drop Deur/Taken (default would show all).
  const mobileTabs: TabKey[] = showDoor
    ? ['start', 'events', 'deur', 'taken', 'meer']
    : ['start', 'events', 'meer'];

  // Door branch: mount the real DoorProvider (offline outbox + realtime) for the
  // venue's current event and render the shared door components. Kept mounted
  // across Deur↔Taken (both are door tabs) so realtime/cache survive the switch;
  // unmounts when leaving for another tab. No event resolvable → empty state.
  const doorTitle = tab === 'taken' ? 'Taken' : 'Check-in';
  let doorBranch: ReactNode;
  if (doorEventQuery.isLoading) {
    doorBranch = <DoorTabState title={doorTitle} text="Even laden…" />;
  } else if (doorEventQuery.data) {
    doorBranch = (
      <DoorQueryProvider>
        <DoorProvider eventId={doorEventQuery.data.id}>
          <PoDoorTab
            tab={tab === 'taken' ? 'taken' : 'deur'}
            overlay={doorOverlay}
            openGuest={openGuest}
            openAdd={openAdd}
            closeOverlay={closeOverlay}
          />
        </DoorProvider>
      </DoorQueryProvider>
    );
  } else {
    doorBranch = <DoorTabState title={doorTitle} text="Geen actief event om in te checken. Maak of open eerst een event." />;
  }

  // Wide desktop screens (home dashboard, guest table, stats charts, audit table)
  // opt into the full content width; every other screen keeps the reading column.
  const activeScreen = top?.name ?? (tabRoot ? tab : '');
  const desktopMainMax = WIDE_DESKTOP[activeScreen] ?? 'max-w-[640px]';

  return (
    <PoProvider value={po}>
      <ResponsiveShell
        serverHint={serverHint}
        isTabRoot={tabRoot}
        mobileTab={tab}
        setMobileTab={nav.setTab}
        mobileTabs={mobileTabs}
        navItems={navItems}
        venueName={liveVenueName ?? venue.name}
        onOpenVenue={() => nav.push('venueswitch')}
        userName={liveUserName ?? 'Account'}
        userSub={liveUserSub ?? ''}
        mainMaxClass={desktopMainMax}
      >
        {isDoorTab ? doorBranch : body}
      </ResponsiveShell>
    </PoProvider>
  );
}
