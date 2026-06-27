'use client';

/**
 * po app shell — a single client tree with an in-memory nav stack + auth flow,
 * rendered through the responsive shell. Events / Gastenlijst / adresboek read
 * live Supabase data; the Deur/Taken tabs mount the real DoorProvider (offline
 * outbox + realtime), so there is no in-memory door state here anymore.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { venues } from '@/lib/po/data';
import type { Venue } from '@/lib/po/types';
import { usePoDoorCandidates, usePoEvents } from '@/features/po/hooks';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { canWorkDoor } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { DoorProvider } from '@/features/door/DoorProvider';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import { setActiveVenueAction } from '@/features/venues/actions';
import {
  PoProvider,
  loadNavState,
  saveNavState,
  type AuthNav,
  type AuthView,
  type Nav,
  type PoApp,
  type PoVenueMembership,
  type ScreenName,
  type StackEntry,
} from './context';
import { usePoHistoryNav } from './history-nav';
import { PhoneFrame, Toast, type TabKey } from './shell';
import { Top } from './kit';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { Invite, Login, Mfa, Otp, Welcome } from './screens/auth';
import { Crew, EventBeheer, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, ContactProfile, GuestsTab, Lijst, QuickAdd, Vaste } from './screens/guests';
import { DoorEventPicker, PoDoorTab, type DoorOverlay } from './screens/door';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';
import { Home } from './screens/home';
import { t, fmt } from '@/lib/i18n';

/** A captured po navigation position. Restoring one sets every nav-relevant piece,
 *  so a single back step can return to a different TAB — not just pop the current
 *  tab's pushed stack. The back button retraces a sequence of these (#37). */
type NavPos = {
  tab: TabKey;
  stack: StackEntry[];
  doorOverlay: DoorOverlay;
  doorEventId: string | null;
  doorSeg: 'deur' | 'taken';
};

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
  <div className="flex h-full flex-1 items-center justify-center text-[14px] text-faint">{t.common.loading}</div>
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
const Templates = dynamic(() => import('./screens/templates').then((m) => m.Templates), {
  loading: ScreenLoading,
  ssr: false,
});
const TemplateEdit = dynamic(() => import('./screens/templates').then((m) => m.TemplateEdit), {
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
  guests: 'max-w-[1080px]',
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
      <Top onBack={onBack} title={t.common.loading} />
      <div className="flex flex-1 items-center justify-center text-[14px] text-faint">{t.common.loading}</div>
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
  myVenues = [],
  activeVenueId = null,
  serverHint = false,
  liveVenueName,
  liveUserName,
  liveUserSub,
}: {
  statsAccess?: { venues: { venueId: string; venueName: string }[] };
  /** The caller's real venue memberships (live), for the venue switcher (#1). */
  myVenues?: PoVenueMembership[];
  /** The active (cookie-resolved) venue id, or null. */
  activeVenueId?: string | null;
  /** Server UA hint for the first-paint viewport switch (corrected by matchMedia). */
  serverHint?: boolean;
  /** Live active-venue name from the session (shell display); mock fallback otherwise. */
  liveVenueName?: string;
  /** Live signed-in user's display name (shell footer). */
  liveUserName?: string;
  /** Live role label (+ MFA) for the shell footer. */
  liveUserSub?: string;
}): JSX.Element {
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
  // S1.3: when the user opens "Check-in" from a specific event card, that event id
  // overrides the venue-wide auto-pick for the Deur/Taken tabs. null = auto-pick.
  const [doorEventId, setDoorEventId] = useState<string | null>(null);
  // Merged Door tab: Check-in ('deur') / Tasks ('taken') segment (was two tabs).
  const [doorSeg, setDoorSeg] = useState<'deur' | 'taken'>('deur');
  const [venue, setVenueState] = useState<Venue>(() => venues.find((v) => v.current) ?? venues[0]);
  const [toast, setToast] = useState<string | null>(null);
  const [key, setKey] = useState(0);

  // Restore the tab + nav stack after a browser refresh (S3.2). Runs once on
  // mount (never during SSR), so there's no hydration mismatch; the persisted
  // screen replaces the default Start on the next frame. `navHydrated` gates the
  // writer below so the initial {start, []} can't clobber the saved value before
  // this read runs.
  const [navHydrated, setNavHydrated] = useState(false);
  // Reactive mirror of navHistory.current.length — drives canGoBack in the nav object.
  const [navHistoryLen, setNavHistoryLen] = useState(0);
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
  // Non-closed events for the door (live-first). Selection-first (S1.3): an explicit
  // pick (doorEventId, set by "Check-in" from an event card) wins; with exactly one
  // candidate we use it; with several, the user chooses — no auto-pick guess. Only
  // the chosen event's guests are ever loaded, so dozens of live events stay cheap.
  const doorCandidatesQuery = usePoDoorCandidates();
  const doorCandidates = doorCandidatesQuery.data ?? [];
  const resolvedDoorId = doorEventId ?? (doorCandidates.length === 1 ? doorCandidates[0].id : null);
  const resolvedDoorName = doorCandidates.find((e) => e.id === resolvedDoorId)?.name ?? '';

  // ── Browser/OS back-button ↔ in-app navigation (full history integration) ─────
  // /app is a single URL with its own in-memory navigation, so the physical back
  // button (browser, mouse, Android system/gesture) must retrace the journey instead
  // of leaving the app. We keep a stack of position snapshots (navHistory): EVERY
  // forward navigation — push a screen, switch a tab, open the door overlay — records
  // the current position + one same-URL history entry, and a real back fires popstate
  // → we restore the previous snapshot. So back undoes pushed screens AND tab switches
  // in reverse (Android-style), only exiting the app at the very first position.
  const isDoorTab = showDoor && started && stack.length === 0 && tab === 'deur';
  const doorOverlayOpen = isDoorTab && doorOverlay !== null;

  const navHistory = useRef<NavPos[]>([]);
  // The current position, recaptured each render so a forward navigation remembers
  // exactly where it left from (which tab + stack + door state).
  const posRef = useRef<NavPos>({ tab, stack, doorOverlay, doorEventId, doorSeg });
  posRef.current = { tab, stack, doorOverlay, doorEventId, doorSeg };
  // One navigation per user gesture: several po cards are clickable rows that ALSO
  // contain action buttons (Home event card = `onClick={onOpen}` on the card + an
  // Open/edit/lock button inside). A button tap bubbles to the row, firing the handler
  // twice → two history entries → two back presses per screen. This guard drops a
  // second navigation in the same synchronous dispatch; the inner (real) target wins.
  const navGuard = useRef(false);

  // A real back (physical button or the in-app chevron): restore the previous
  // position. A no-op when empty → the browser then leaves /app and the app exits.
  const restorePrevious = (): void => {
    const prev = navHistory.current.pop();
    if (!prev) return;
    setTabState(prev.tab);
    setStack(prev.stack);
    setDoorOverlay(prev.doorOverlay);
    setDoorEventId(prev.doorEventId);
    setDoorSeg(prev.doorSeg);
    setNavHistoryLen((l) => Math.max(0, l - 1));
    bump();
  };
  const histNav = usePoHistoryNav({ enabled: navHydrated && started, onBack: restorePrevious });

  // A forward navigation: remember where we are, add a history entry, then change.
  const navigate = (apply: () => void): void => {
    if (navGuard.current) return;
    navGuard.current = true;
    queueMicrotask(() => {
      navGuard.current = false;
    });
    navHistory.current.push(posRef.current);
    setNavHistoryLen((l) => l + 1);
    histNav.recordNavigate();
    apply();
    bump();
  };

  // Rebuild the back-path within the restored tab after a refresh into a deep screen
  // (pre-refresh tab-switch history isn't persisted — acceptable): one snapshot + one
  // history entry per stack prefix, so the back button works immediately. The ref
  // guard keeps it idempotent under React StrictMode's double-invoke (no double entries).
  const reconstructed = useRef(false);
  useEffect(() => {
    if (!navHydrated || reconstructed.current) return;
    reconstructed.current = true;
    if (stack.length === 0) return;
    navHistory.current = stack.map((_, i): NavPos => ({
      tab,
      stack: stack.slice(0, i),
      doorOverlay: null,
      doorEventId: null,
      doorSeg: 'deur',
    }));
    stack.forEach(() => histNav.recordNavigate());
    setNavHistoryLen(stack.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navHydrated]);

  const nav: Nav = {
    push: (name: ScreenName, props = {}) => {
      navigate(() => setStack((s) => [...s, { name, props }]));
    },
    // The physical back button and the in-app chevron share one path via the History API.
    back: () => {
      histNav.goBack();
    },
    setTab: (t: TabKey) => {
      // Re-tapping the current tab at its root is a true no-op — don't add a back step.
      if (t === tab && stack.length === 0 && doorOverlay === null) return;
      navigate(() => {
        setTabState(t);
        setStack([]);
        setDoorOverlay(null);
        setDoorEventId(null); // a manual tab tap returns the door to its auto-pick (S1.3)
      });
    },
    // "Check-in" from a specific event: open the Deur tab for THAT event (S1.3).
    openDoor: (eventId: string) => {
      navigate(() => {
        setDoorEventId(eventId);
        setTabState('deur');
        setDoorSeg('deur');
        setStack([]);
        setDoorOverlay(null);
      });
    },
    canGoBack: navHistoryLen > 0,
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

  // Door-overlay navigation (Deur/Taken tabs): opening the overlay is a forward step
  // (it hides the tab bar like a pushed screen); closing routes through back so the
  // physical button and the overlay's own close button share one path.
  const openGuest = (id: string): void => navigate(() => setDoorOverlay({ kind: 'guest', id }));
  const openAdd = (): void => navigate(() => setDoorOverlay({ kind: 'add' }));
  const closeOverlay = (): void => histNav.goBack();

  const switchVenue = (v: Venue): void => {
    setVenueState(v);
    setDoorEventId(null); // the override belongs to the old venue's events (S1.3)
    setToast(fmt(t.venue.switched, { name: v.name }));
    setTimeout(() => setToast(null), 2200);
    nav.back();
  };

  // Switch the ACTIVE venue for real (#1): write the server cookie, then full-reload
  // so app/page.tsx re-resolves the identity and every live query re-scopes to the
  // new venue. (Local state alone can't re-scope server-resolved identity.)
  const switchToVenue = (venueId: string): void => {
    if (venueId === activeVenueId) {
      nav.back();
      return;
    }
    setToast(t.venue.switching);
    const fd = new FormData();
    fd.set('venueId', venueId);
    void setActiveVenueAction(fd).then(() => window.location.assign('/app'));
  };

  const ev = (id?: string) => events.find((e) => e.id === id);

  // Tab bar is always visible when authenticated, even on pushed/detail screens.
  // Door overlays (in-tab check-in detail) are the only exception — they run
  // full-screen within the Deur tab where tab-switching is not useful.
  const tabRoot = started && !doorOverlayOpen;

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
      case 'guest':
        // Tapping a guest opens the unified person profile (linked → cross-event,
        // name-only → this one event), with the originating event pinned on top.
        screen = <ContactProfile guestId={p.id} originEventId={p.eventId} />;
        break;
      case 'contacten':
        screen = <Contacten eventId={p.id} />;
        break;
      case 'contactprofile':
        screen = <ContactProfile contactId={p.id} />;
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
        screen = <Aanvragen eventId={p.id} initialTab={p.tab} />;
        break;
      case 'eventedit':
        screen = <EventEdit id={p.id} isNew={p.isNew} />;
        break;
      case 'tiers':
        screen = <Tiers eventId={p.id} />;
        break;
      case 'crew':
        screen = <Crew eventId={p.id} />;
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
      case 'templates':
        screen = <Templates />;
        break;
      case 'templateedit':
        screen = <TemplateEdit id={p.id} isNew={p.isNew} />;
        break;
      default:
        screen = null;
    }
  } else if (tab === 'start') screen = <Home />;
  else if (tab === 'events') screen = <Events />;
  else if (tab === 'guests') screen = <GuestsTab />;
  else if (tab === 'meer') screen = <Meer />;
  // 'deur' renders via the door branch below when allowed; for a non-door role
  // (showDoor=false) the tab is hidden, so fall back to the home.
  else screen = <Home />;

  const po: PoApp = {
    venue,
    switchVenue,
    statsVenues: statsAccess?.venues ?? [],
    myVenues,
    activeVenueId,
    switchToVenue,
    nav,
  };

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
    top?.name === 'stats'
      ? 'stats'
      : top?.name === 'gebruikers'
        ? 'gebruikers'
        : top?.name === 'aanvragen'
          ? 'aanvragen'
          : tab;
  const caps = venueCapabilities(roles);
  const canViewStats = (statsAccess?.venues.length ?? 0) > 0;
  // Venue-wide approval inbox in the desktop sidebar. Gated on admin — the
  // reliable venue-level decider (organizers act per-event, finance is read-only).
  // Everyone still reaches requests via Home's clickable tiles / per-event cards.
  const canDecideRequests = roles.includes('admin');
  const navItems: ShellNavItem[] = [
    { key: 'start', section: 'main', label: t.nav.home, icon: 'grid', active: currentKey === 'start', onClick: () => nav.setTab('start') },
    { key: 'events', section: 'main', label: t.nav.events, icon: 'cal', active: currentKey === 'events', onClick: () => nav.setTab('events') },
    { key: 'guests', section: 'main', label: t.nav.guests, icon: 'user', active: currentKey === 'guests', onClick: () => nav.setTab('guests') },
    ...(showDoor
      ? ([{ key: 'deur', section: 'main', label: t.nav.door, icon: 'door', active: currentKey === 'deur', onClick: () => nav.setTab('deur') }] as ShellNavItem[])
      : []),
    ...(canDecideRequests
      ? ([{ key: 'aanvragen', section: 'more', label: t.nav.requests, icon: 'inbox', active: currentKey === 'aanvragen', onClick: () => nav.push('aanvragen') }] as ShellNavItem[])
      : []),
    ...(canViewStats
      ? ([{ key: 'stats', section: 'more', label: t.nav.analytics, icon: 'spark', active: currentKey === 'stats', onClick: () => nav.push('stats') }] as ShellNavItem[])
      : []),
    ...(caps.viewTeam
      ? ([{ key: 'gebruikers', section: 'more', label: t.nav.team, icon: 'users', active: currentKey === 'gebruikers', onClick: () => nav.push('gebruikers') }] as ShellNavItem[])
      : []),
    { key: 'meer', section: 'more', label: t.nav.more, icon: 'dots', active: currentKey === 'meer', onClick: () => nav.setTab('meer') },
  ];
  // Mobile bottom tabs — non-door roles drop Deur/Taken (default would show all).
  const mobileTabs: TabKey[] = showDoor
    ? ['start', 'events', 'guests', 'deur', 'meer']
    : ['start', 'events', 'guests', 'meer'];

  // Door branch: mount the real DoorProvider (offline outbox + realtime) for the
  // venue's current event and render the shared door components. Kept mounted
  // across Deur↔Taken (both are door tabs) so realtime/cache survive the switch;
  // unmounts when leaving for another tab. No event resolvable → empty state.
  const doorTitle = doorSeg === 'taken' ? t.door.tasksTitle : t.door.checkinTitle;
  let doorBranch: ReactNode;
  if (resolvedDoorId) {
    doorBranch = (
      <DoorQueryProvider>
        <DoorProvider eventId={resolvedDoorId}>
          <PoDoorTab
            tab={doorSeg}
            onTab={setDoorSeg}
            overlay={doorOverlay}
            openGuest={openGuest}
            openAdd={openAdd}
            closeOverlay={closeOverlay}
            currentEventName={doorCandidates.length > 1 ? resolvedDoorName : undefined}
            onChangeEvent={doorCandidates.length > 1 ? () => setDoorEventId(null) : undefined}
          />
        </DoorProvider>
      </DoorQueryProvider>
    );
  } else if (doorCandidatesQuery.isLoading) {
    doorBranch = <DoorTabState title={doorTitle} text={t.common.loading} />;
  } else if (doorCandidates.length > 1) {
    // Several live/open events and nothing picked yet → choose first (S1.3). The
    // /app shell keeps the bottom-tab menu visible around this picker.
    doorBranch = <DoorEventPicker events={doorCandidates} onPick={setDoorEventId} />;
  } else {
    doorBranch = <DoorTabState title={doorTitle} text={t.door.noEvent} />;
  }

  // Wide desktop screens (home dashboard, guest table, stats charts, audit table)
  // opt into the full content width; every other screen keeps the reading column.
  const activeScreen = top?.name ?? tab;
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
        userName={liveUserName ?? t.common.account}
        userSub={liveUserSub ?? ''}
        mainMaxClass={desktopMainMax}
      >
        {isDoorTab ? doorBranch : body}
      </ResponsiveShell>
    </PoProvider>
  );
}
