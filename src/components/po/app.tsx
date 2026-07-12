'use client';

/**
 * po app shell — a single client tree with real per-screen URLs (G1), rendered
 * through the responsive shell (auth is real middleware + /login + /mfa,
 * outside this tree). Events / Gastenlijst / adresboek read
 * live Supabase data; the Deur/Taken tabs mount the real DoorProvider (offline
 * outbox + realtime), so there is no in-memory door state here anymore.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import { usePoCanManageTemplates, usePoDoorCandidates, usePoEvents, usePoGuestRequests } from '@/features/po/hooks';
import { isOpenGuestRequest } from '@/features/po/adapters';
import { autoOpenDoorEvent } from '@/features/po/door-event';
import { poKeys } from '@/features/po/keys';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useAppShellData } from './app-shell-data';
import { canSeeAnyRequests, canWorkDoor } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { DoorProvider } from '@/features/door/DoorProvider';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import { setActiveVenueAction } from '@/features/venues/actions';
import { PoProvider, type Nav, type PoApp, type ScreenName, type ScreenProps } from './context';
import { doorPath, parseAppUrl, screenPath, tabPath, type DoorSeg, type ParsedTarget } from './routes';
import { Toast, type TabKey } from './shell';
import { Top } from './kit';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { useViewport } from './use-viewport';
import { EventDaySkeleton } from '@/features/po/eventday/EventDaySkeleton';
import { Crew, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, ContactProfile, GuestsTab, QuickAdd } from './screens/guests';
import { DoorEventPicker, PoDoorTab, type DoorOverlay } from './screens/door';
import { Allowance, Billing, Gebruikers, Import, Meer, Profile, Rollen, VenueSettings, VenueSwitch } from './screens/settings';
import { VenueCreate } from './screens/onboarding';
import { Home } from './screens/home';
import { t } from '@/lib/i18n';

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
const Links = dynamic(() => import('./screens/links').then((m) => m.Links), {
  loading: ScreenLoading,
  ssr: false,
});
const Influencers = dynamic(() => import('./screens/influencers').then((m) => m.Influencers), {
  loading: ScreenLoading,
  ssr: false,
});
const Promo = dynamic(() => import('./screens/promo').then((m) => m.Promo), {
  loading: ScreenLoading,
  ssr: false,
});
// Desktop Deur view (T9 fold): the Event-dag cockpit, previously the standalone
// /eventday route, now renders INSIDE the shell as the ≥1024px variant of the
// Door tab. Lazy — mobile/door-only visitors never pull the cockpit chunk; the
// geometry-matched skeleton keeps the frame steady while it fetches.
const EventDayCockpitGate = dynamic(
  () => import('@/features/po/eventday/EventDayCockpit').then((m) => m.EventDayCockpitGate),
  { loading: () => <EventDaySkeleton />, ssr: false },
);

/** Data-dense screens that opt into the full 1080px desktop column. Forms and
 *  detail-entry screens stay at the narrow reading column (640px). Mobile is
 *  full-bleed regardless. (S3.3) */
const WIDE_DESKTOP = new Set([
  'start', 'events', 'guests', 'lijst', 'stats', 'audit', 'gebruikers',
  'event', 'pastevent', 'aanvragen', 'deur',
]);

/** Which top-level nav entry a pushed screen visually belongs to (G1): drives
 *  the desktop sidebar's `active` highlight and — collapsed onto the 5 mobile
 *  bottom tabs by `mobileTabForScreen` below — which tab stays lit while a
 *  pushed screen is open. Replaces the old NAV_PUSHED/currentKey lookup: real
 *  URLs don't carry "which tab you pushed from", so this is a static, per-screen
 *  mapping instead of a runtime-preserved `tab` value.
 *
 *  `guest` always maps to 'guests', matching its real URL taxonomy
 *  (`/app/guests/:id`, never nested under an event) — NOT `props.eventId ? …`.
 *  `eventId` there is the "originating event pinned on top" display scope
 *  (passed by both the Guests-tab list AND an event's guest list, since every
 *  guest belongs to some event), not a signal for which nav item pushed the
 *  screen; branching nav highlighting on it was wrong in both directions (a
 *  Guests-tab guest always has a truthy eventId → wrongly highlighted Events,
 *  while the past-event recap's guest links omit eventId → wrongly highlighted
 *  Guests). There's no reliable "who pushed this" signal without threading a
 *  new field through routes.ts purely for cosmetics — not worth it. */
function navKeyForScreen(name: ScreenName, _props: ScreenProps): string {
  switch (name) {
    case 'event':
    case 'eventedit':
    case 'lijst':
    case 'tiers':
    case 'crew':
    case 'allowance':
    case 'links':
    case 'quickadd':
    case 'bulk':
    case 'pastevent':
      return 'events';
    case 'guest':
      return 'guests';
    case 'contacten':
    case 'contactprofile':
      return 'contacten';
    case 'aanvragen':
      return 'aanvragen';
    case 'stats':
      return 'stats';
    case 'promo':
      return 'promo';
    case 'gebruikers':
      return 'gebruikers';
    default:
      // rollen, import, venueswitch, venuesettings, venuecreate, profile,
      // billing, audit, adminsessions, templates, templateedit, influencers —
      // all live under the More hub on both mobile and desktop.
      return 'meer';
  }
}

/** Mobile only has 5 real bottom tabs — collapse every desktop-only sidebar
 *  entry (Contacts/Requests/Analytics/Promotion/Team) onto "Meer", matching
 *  where those screens actually live in the mobile nav. */
const MOBILE_TABS: ReadonlySet<string> = new Set(['start', 'events', 'guests', 'deur', 'meer']);
function mobileTabForScreen(name: ScreenName, props: ScreenProps): TabKey {
  const key = navKeyForScreen(name, props);
  return (MOBILE_TABS.has(key) ? key : 'meer') as TabKey;
}

/** Best-effort parent path for a screen with no real browser-history entry to
 *  pop (G1 review): a cold deep link — fresh tab, bookmark, or the consent/MFA
 *  `next=` round-trip — has nothing "before" it in THIS tab's history, so
 *  `router.back()` would either no-op or leave the app/land on an unrelated
 *  prior page. `back()`/`closeOverlay` fall through to pushing this instead.
 *  Event-nested screens zoom out one level (to their event, or its guest
 *  list); everything else falls back to its tab, via the same
 *  `mobileTabForScreen` mapping the sidebar/bottom-tab highlight uses. */
function parentPathFor(target: ParsedTarget): string {
  if (target.kind === 'tab') return tabPath('start');
  if (target.kind === 'door') {
    return target.overlay ? doorPath({ seg: target.seg, eventId: target.eventId ?? undefined }) : tabPath('start');
  }
  const { name, props } = target;
  switch (name) {
    case 'eventedit':
      return props.isNew ? tabPath('events') : screenPath('event', { id: props.id });
    case 'lijst':
    case 'tiers':
    case 'crew':
    case 'links':
      return screenPath('event', { id: props.id });
    case 'quickadd':
    case 'bulk':
      return props.id ? screenPath('lijst', { id: props.id }) : tabPath('events');
    case 'event':
    case 'pastevent':
      return tabPath('events');
    case 'guest':
      return props.eventId ? screenPath('lijst', { id: props.eventId }) : tabPath('guests');
    case 'contactprofile':
      return tabPath('guests');
    case 'templateedit':
      return screenPath('templates', {});
    default:
      // mobileTabForScreen's declared return type includes 'deur', but
      // navKeyForScreen never yields it for a `kind: 'screen'` target (that
      // key is reserved for `kind: 'door'`, handled above) — safe to narrow.
      return tabPath(mobileTabForScreen(name, props) as Exclude<TabKey, 'deur'>);
  }
}

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

// Tracks whether a real, poppable history entry has been pushed yet THIS
// browser-tab session (e2e-review fix). A cold deep link (fresh tab,
// bookmark, the consent/MFA `next=` round-trip) starts with nothing to pop —
// `router.back()` there would no-op or leave the app. `back()`/`closeOverlay`
// check this before deciding between a real `router.back()` and a computed
// parent path. `router.replace` never sets it: swapping the current entry
// doesn't create anything new to go back to.
//
// MODULE-level, not a `useRef` inside `PlusOneApp`: every `router.push`/
// `replace`-driven navigation on this fully-dynamic catch-all route remounts
// `PlusOneApp` entirely (confirmed empirically — a mount/unmount probe fired
// on every single navigation, including plain screen-to-screen pushes). A
// `useRef` is scoped to the component INSTANCE, so it reset to its initial
// `false` on every navigation and `back()` NEVER took the real-history
// branch — the e2e core-flow test caught this: clicking Back after creating
// an event landed on the event's own detail page (the cold-deep-link
// fallback's target) instead of the events list a real `router.back()` would
// have reached. A plain module variable survives the remount (same JS module
// instance across client-side navigations) and only resets on an actual full
// page load — exactly the "cold deep link" signal this needs. Door sub-nav
// (`pushDoorState`) doesn't have this problem — it bypasses `router.push`
// entirely, so it never triggers the remount in the first place.
let hasPushedThisSession = false;

export function PlusOneApp(): JSX.Element {
  // Server-resolved display data (venue list, stats access, live names) — set
  // once by the /app layout (G1), not re-fetched per screen navigation.
  const {
    statsAccess,
    myVenues,
    activeVenueId,
    serverHint,
    liveVenueName,
    liveUserName,
    liveUserSub,
  } = useAppShellData();
  // Same breakpoint/source as ResponsiveShell — picks the door branch's variant
  // below (≥1024px = Event-dag cockpit, <1024px = the outbox-backed door tab).
  const isMobile = useViewport(serverHint);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // The live URL IS the nav state (G1) — no in-memory stack, no sessionStorage
  // restore-after-refresh hack. Every screen/tab/door-overlay derives from this
  // single parse of the current pathname + query string.
  const target = parseAppUrl(pathname, searchParams);
  const doorSeg = target.kind === 'door' ? target.seg : 'deur';
  const doorEventIdFromUrl = target.kind === 'door' ? target.eventId : null;
  const doorOverlay: DoorOverlay = target.kind === 'door' ? target.overlay : null;
  const searchParamsStr = searchParams.toString();

  // Door sub-state override (G1 fresh-review fix). `router.push`/`replace` on
  // this dynamic route hits the server for a fresh RSC payload on ANY
  // search-param change — Next's client router keys cached page data by the
  // full search string, and the search-param-aliasing optimization that would
  // avoid this needs a `loading.tsx` this route doesn't have — regardless of
  // page.tsx reading no searchParams itself. Confirmed live: opening a guest
  // overlay produced a real `GET .../door?guest=…&_rsc=…` request. That breaks
  // the door's offline invariant (#25) for every overlay open/close and
  // segment switch, and even online turns what used to be instant into a
  // blocking round-trip. Fix: drive door sub-state through raw
  // `window.history.pushState/replaceState` (`pushDoorState`/`replaceDoorState`
  // below) instead — no server involved — and shadow the URL-derived door
  // fields with this local override until Next's OWN hooks report a genuine
  // change (a real router-driven navigation, or a browser back/forward
  // popstate, which Next resyncs on its own regardless of who pushed the
  // entry) — the effect below clears the shadow at that point so the
  // URL becomes authoritative again. Desktop's cockpit is unaffected (it's
  // online-only by design, no outbox, and never sets this override).
  const [doorOverride, setDoorOverride] = useState<{
    seg: DoorSeg;
    eventId: string | null;
    overlay: DoorOverlay;
  } | null>(null);
  useEffect(() => {
    setDoorOverride(null);
  }, [pathname, searchParamsStr]);
  const doorState = doorOverride ?? { seg: doorSeg, eventId: doorEventIdFromUrl, overlay: doorOverlay };

  const [toast, setToast] = useState<string | null>(null);
  // Retriggers the CSS entrance animation on every navigation (any URL change).
  // A derived key, not a bumped useState — a state+effect pair here meant every
  // navigation mounted the new screen once with the OLD key, then the effect
  // fired and remounted it again under a bumped key, so screen mount effects
  // ran twice per navigation (review fix).
  const key = `${pathname}?${searchParamsStr}`;

  const { userId, roles } = usePoIdentity();

  // Stripe Checkout return (fase 13, #32): the hosted checkout redirects back to
  // /app?billing=success|canceled. Strip the flag from the URL immediately (a
  // refresh must not re-toast) and park it in sessionStorage with a timestamp:
  // the shell remounts once identity/live data settles, which would wipe a
  // plain useState toast set on the first mount. Every mount re-reads the
  // parked flag while it is fresh (< toast duration), so the surviving mount
  // shows the toast; the flag is deleted when the toast clears (or ignored
  // once stale, if the user navigated away mid-toast).
  const qc = useQueryClient();
  useEffect(() => {
    const KEY = 'po:billing-return';
    const TOAST_MS = 4000;
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('billing');
    if (fromUrl) {
      params.delete('billing');
      const rest = params.toString();
      // G1: every screen has its own path now — strip just the `billing` flag,
      // keep whatever path Stripe redirected back to (not always bare `/app`).
      window.history.replaceState(window.history.state, '', rest ? `${window.location.pathname}?${rest}` : window.location.pathname);
      try {
        sessionStorage.setItem(KEY, JSON.stringify({ v: fromUrl, ts: Date.now() }));
      } catch {
        /* storage unavailable: lose the toast, nothing else depends on it */
      }
    }
    let parked: string | null = null;
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) {
        const { v, ts } = JSON.parse(raw) as { v: string; ts: number };
        if (Date.now() - ts < TOAST_MS) parked = v;
        else sessionStorage.removeItem(KEY); // stale leftover from an abandoned visit
      }
    } catch {
      parked = fromUrl;
    }
    if (!parked) return;
    if (activeVenueId) {
      void qc.invalidateQueries({ queryKey: poKeys.subscription(activeVenueId) });
    }
    if (parked === 'success') setToast(t.settings.billing.checkoutSuccess);
    else if (parked === 'canceled') setToast(t.settings.billing.checkoutCanceled);
    else return; // portal-return and unknown values: silent refresh only
    const timer = setTimeout(() => {
      setToast(null);
      try {
        sessionStorage.removeItem(KEY);
      } catch {
        /* ignore */
      }
    }, TOAST_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs per mount, self-guarded
  }, []);

  // Live data for the /app surface (STAP 3.4 + the events-live id-passing slice
  // of 3.3): the Events tab, event detail, and Gastenlijst resolve real Supabase
  // rows instead of the in-memory mock. The Deur/Taken tabs are wired live too
  // (STAP 3.5) — they mount the real DoorProvider for the venue's current event.
  // Only door roles (admin / doorhost) see the Deur/Taken tabs — staff/finance/
  // user_manager can't read check_ins/refusals (#17), so the door would look
  // empty/"mock" for them. Organizers use /door/[eventId] directly.
  const showDoor = canWorkDoor(roles);
  const isDoorTab = showDoor && target.kind === 'door';

  // The active screen/tab key, used for Sentry breadcrumbs + the desktop column
  // width. Screen ids are internal constants (PII-free) — never the raw path,
  // which can carry real entity ids.
  const activeScreenKey: string =
    target.kind === 'screen' ? target.name : target.kind === 'door' ? 'deur' : target.tab;

  // Sentry po-screen context (fase 4.2): tag the active screen + a navigation
  // breadcrumb centrally, from the URL-derived key — every push/tab/back/replace
  // flows through the router, so this fires on every real navigation for free.
  useEffect(() => {
    Sentry.setTag('po.screen', activeScreenKey);
    Sentry.addBreadcrumb({ category: 'navigation', message: activeScreenKey, level: 'info' });
  }, [activeScreenKey]);

  // Contacts desktop-nav gate (T10). Called here (before any early return) so the
  // hook order stays stable; the gate itself is computed with `caps` further down.
  const canManageTemplates = usePoCanManageTemplates();
  const { data: liveEvents } = usePoEvents();
  const events = liveEvents ?? [];
  // Non-closed events for the door (live-first). Selection-first (S1.3): an explicit
  // pick (doorEventIdFromUrl, the `?event=` on the door URL, set by "Check-in" from
  // an event card) wins; with exactly one candidate we use it; with several, the
  // user chooses — no auto-pick guess. Only the chosen event's guests are ever
  // loaded, so dozens of live events stay cheap.
  const doorCandidatesQuery = usePoDoorCandidates();
  const doorCandidates = doorCandidatesQuery.data ?? [];
  // Open-requests count for the nav badge (desktop sidebar + mobile More). Reuses
  // the venue-wide guest-requests query that Home already loads (shared React
  // Query key → no extra polling); OPEN = pending only, the shared definition, so
  // this badge matches Home's tile and the event-card badge exactly (T9).
  const openRequestCount = (usePoGuestRequests().data ?? []).filter(isOpenGuestRequest).length;
  const requestedDoorId = doorState.eventId ?? (doorCandidates.length === 1 ? doorCandidates[0].id : null);
  // Validate the requested id against the real candidate list once it has
  // loaded (G1 review fix — the desktop cockpit already does this via
  // `candidates.find(...)`). Without it, a stale `?event=` — e.g. left over
  // from a venue switch, or reached via the browser's own back/forward —
  // would mount DoorProvider for an event that isn't even this venue's, since
  // an id alone can't be told apart from a foreign one without checking. Skip
  // the check while candidates are still loading so an explicit id from the
  // URL doesn't flash "no event" before the list arrives.
  const resolvedDoorId =
    requestedDoorId && (doorCandidatesQuery.isLoading || doorCandidates.some((e) => e.id === requestedDoorId))
      ? requestedDoorId
      : null;
  const resolvedDoorName = doorCandidates.find((e) => e.id === resolvedDoorId)?.name ?? '';
  // If a requested id isn't in the loaded candidate list, the list itself
  // might just be stale rather than the id being genuinely foreign — e.g.
  // another staff member created/started the event moments ago, or this
  // client's own mutation fired before the invalidation above landed.
  // Refetch once per id before accepting the rejection (G1 review fix; pairs
  // with the doorCandidates invalidation added to the event mutations, which
  // only covers changes made from THIS client).
  const staleDoorRefetchRef = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedDoorId || doorCandidatesQuery.isLoading || doorCandidatesQuery.isFetching) return;
    if (doorCandidates.some((e) => e.id === requestedDoorId)) return;
    if (staleDoorRefetchRef.current === requestedDoorId) return; // already retried this one
    staleDoorRefetchRef.current = requestedDoorId;
    void doorCandidatesQuery.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- doorCandidatesQuery itself (incl. .refetch) is intentionally omitted: it's a new object each render, and including it would refire this every render instead of only when the inputs actually change
  }, [requestedDoorId, doorCandidatesQuery.isLoading, doorCandidatesQuery.isFetching, doorCandidates]);

  // One navigation per user gesture: several po cards are clickable rows that ALSO
  // contain action buttons (Home event card = `onClick={onOpen}` on the card + an
  // Open/edit/lock button inside). A button tap bubbles to the row, firing the handler
  // twice → two router.push calls. This guard drops a second navigation in the same
  // synchronous dispatch; the inner (real) target wins.
  const navGuard = useRef(false);
  const guarded = (apply: () => void): void => {
    if (navGuard.current) return;
    navGuard.current = true;
    queueMicrotask(() => {
      navGuard.current = false;
    });
    apply();
  };

  const pushUrl = (url: string): void => {
    hasPushedThisSession = true;
    router.push(url);
  };

  // Mobile door sub-nav (guest/add overlay, Deur↔Taken segment, event
  // override) — raw History API, entirely bypassing `router.push/replace`
  // (see the `doorOverride` comment above for why). `pushDoorState` marks a
  // real poppable entry same as `pushUrl`; `replaceDoorState` doesn't, same
  // as a plain `router.replace`.
  type DoorState = { seg: DoorSeg; eventId: string | null; overlay: DoorOverlay };
  const pushDoorState = (next: DoorState): void => {
    hasPushedThisSession = true;
    setDoorOverride(next);
    window.history.pushState(window.history.state, '', doorPath(next));
  };
  const replaceDoorState = (next: DoorState): void => {
    setDoorOverride(next);
    window.history.replaceState(window.history.state, '', doorPath(next));
  };

  // T6 auto-open (decided 1/7): on the FIRST visit of this browser session (per
  // user), when the desktop shell (≥1024px) has exactly ONE event inside its door
  // window (start − 1h through event end) AND the user landed on the bare Start
  // tab, replace it with the Door tab — the Event-day cockpit. Two or more
  // simultaneous nights → no guessing, land normally. It runs ONCE per session
  // (sessionStorage flag), so deliberately navigating away never pushes the user
  // back; a mid-session refresh doesn't re-trigger either. A `router.replace` —
  // no history entry: this replaces the landing, it isn't a step the back button
  // should undo. Gated to the Start tab (G1): a deep link into another screen on
  // the first visit must never be hijacked into the cockpit.
  const autoOpenTried = useRef(false);
  useEffect(() => {
    if (autoOpenTried.current || isMobile || !showDoor) return;
    const cands = doorCandidatesQuery.data;
    if (!cands) return; // wait for candidates before consuming the one evaluation
    // Consume the one-shot evaluation NOW, regardless of which tab this turns
    // out to be (G1 review fix): stamping this only inside the Start-tab branch
    // left the flag armed for a session whose first landing was a deep link
    // elsewhere, so a later deliberate tap on Home would still get hijacked
    // into the cockpit. Evaluating once — on whatever screen loads first —
    // and THEN checking Start below preserves "never hijack a first-visit deep
    // link" while actually enforcing "once per session".
    autoOpenTried.current = true;
    const KEY = `po:eventday-auto:${userId}`;
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, '1');
    } catch {
      return; // no sessionStorage → skip rather than re-push on every mount
    }
    if (!(target.kind === 'tab' && target.tab === 'start')) return;
    const id = autoOpenDoorEvent(cands, Date.now());
    if (!id) return;
    router.replace(doorPath({ seg: 'deur', eventId: id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot landing tweak
  }, [isMobile, showDoor, doorCandidatesQuery.data, userId, target]);

  const doorOverlayOpen = isDoorTab && doorState.overlay !== null;

  const nav: Nav = {
    push: (name: ScreenName, props = {}) => guarded(() => pushUrl(screenPath(name, props))),
    // No history entry: the current position is swapped, not stacked. For
    // after-create flows: "New event" → replace with the created event's
    // settings, so back returns to where the flow started instead of the stale
    // create form.
    replace: (name: ScreenName, props = {}) => guarded(() => router.replace(screenPath(name, props))),
    // Real history to pop (pushed earlier this session) → let the browser go
    // back. Otherwise (cold deep link) → zoom out to the screen's parent
    // instead of no-op'ing or leaving the app. `replace`, NOT `pushUrl`: a
    // fallback that pushed would leave the ORIGINAL deep-linked screen sitting
    // right behind the parent in history, and — since it also latched
    // hasPushedThisSession — the very next back() would take the real-history
    // branch and pop straight back into that stale child, oscillating
    // child↔parent forever instead of climbing. `replace` swaps in place and
    // never latches, so a second cold back() computes a fresh parent from the
    // new (parent) target and keeps ascending (review fix).
    back: () => guarded(() => (hasPushedThisSession ? router.back() : router.replace(parentPathFor(target)))),
    setTab: (t: TabKey) =>
      guarded(() => {
        if (t === 'deur') {
          // Re-tapping Deur while already on its root (no overlay) is a no-op.
          // Checks doorState (override-aware), not target.overlay — the
          // latter can be stale while a raw-history door override is active.
          if (target.kind === 'door' && doorState.overlay === null) return;
          pushUrl(doorPath());
          return;
        }
        // Re-tapping the current tab at its root is a true no-op.
        if (target.kind === 'tab' && target.tab === t) return;
        pushUrl(tabPath(t));
      }),
    // "Check-in" from a specific event: open the Deur tab for THAT event (S1.3).
    openDoor: (eventId: string) => guarded(() => pushUrl(doorPath({ seg: 'deur', eventId }))),
    // A real per-screen URL: every pushed screen has a parent to go back to
    // (a real history entry, or the computed fallback above).
    canGoBack: target.kind === 'screen',
  };

  // Door-overlay navigation (Deur/Taken tabs): opening the overlay is a forward
  // step (it hides the tab bar like a pushed screen) — a real history entry, so
  // the physical back button and the overlay's own close button share one path.
  // Raw history (pushDoorState), not pushUrl/router.push — see doorOverride.
  const openGuest = (id: string): void =>
    guarded(() => pushDoorState({ seg: doorState.seg, eventId: doorState.eventId, overlay: { kind: 'guest', id } }));
  const openAdd = (): void =>
    guarded(() => pushDoorState({ seg: doorState.seg, eventId: doorState.eventId, overlay: { kind: 'add' } }));
  // Same cold-deep-link fallback as nav.back() — a directly-linked overlay
  // (e.g. a shared door URL) has no history to pop either. `replace`, not
  // `pushUrl`, for the same non-latching reason as `nav.back()` above.
  const closeOverlay = (): void =>
    guarded(() => (hasPushedThisSession ? router.back() : router.replace(parentPathFor(target))));

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
    void setActiveVenueAction(fd)
      .then(() => {
        window.location.assign('/app');
      })
      .catch(() => {
        // Switch failed (network blip / server error) — stay on the old venue.
        setToast(null);
      });
  };

  const ev = (id?: string) => events.find((e) => e.id === id);

  // Tab bar is always visible when authenticated, even on pushed/detail screens.
  // Door overlays (in-tab check-in detail) are the only exception — they run
  // full-screen within the Deur tab where tab-switching is not useful.
  const tabRoot = !doorOverlayOpen;

  let screen: ReactNode;
  if (target.kind === 'screen') {
    const p = target.props;
    switch (target.name) {
      case 'event':
        screen = <EventView id={p.id} />;
        break;
      case 'lijst': {
        const e = ev(p.id);
        screen = e ? <GuestsTab pinnedEventId={e.id} /> : <Loading onBack={nav.back} />;
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
        screen = <VenueSettings />;
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
      case 'links':
        screen = <Links eventId={p.id} />;
        break;
      case 'influencers':
        screen = <Influencers />;
        break;
      case 'promo':
        screen = <Promo />;
        break;
      default:
        screen = null;
    }
  } else if (target.kind === 'tab') {
    switch (target.tab) {
      case 'start':
        screen = <Home />;
        break;
      case 'events':
        screen = <Events />;
        break;
      case 'guests':
        screen = <GuestsTab />;
        break;
      case 'meer':
        screen = <Meer />;
        break;
    }
  } else {
    // A 'door' URL for a non-door role (unreachable via the nav UI — the tab is
    // hidden — but a stray/typed URL should degrade gracefully, not blank).
    screen = <Home />;
  }

  const po: PoApp = {
    statsVenues: statsAccess?.venues ?? [],
    myVenues,
    activeVenueId,
    switchToVenue,
    nav,
    isMobile,
  };

  const body = (
    <>
      <div key={key} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {toast && <Toast>{toast}</Toast>}
    </>
  );

  // Signed-in: responsive shell — desktop sidebar ≥1024px, mobile tabs below it
  // (S0 nav-shell). Screens are unchanged for now; wired live per S1+.
  const currentKey =
    target.kind === 'tab' ? target.tab : target.kind === 'door' ? 'deur' : navKeyForScreen(target.name, target.props);
  const mobileTab: TabKey =
    target.kind === 'tab' ? target.tab : target.kind === 'door' ? 'deur' : mobileTabForScreen(target.name, target.props);
  const caps = venueCapabilities(roles);
  // Contacts is a desktop-menu item (T10) — the venue address book. Same gate as
  // the mobile More-hub row (admin/finance settings-view OR a venue organizer).
  // On mobile it stays under More: the bottom bar uses the fixed mobileTabs list.
  const canViewContacts = caps.viewSettings || canManageTemplates;
  const canViewStats = (statsAccess?.venues.length ?? 0) > 0;
  // Requests row in the sidebar/More hub — was admin-only, so finance/staff had
  // NO nav route and could only reach the inbox via Home's tiles (K-5: "dezelfde
  // functie is per ingang anders gegate"). M5 (8/7) unified this gate across the
  // More hub / sidebar / Home tiles as "admin or an organizer-at-this-venue"
  // (`canManageTemplates`, a real fetchOrganizesAtVenue query — not a roles-array
  // heuristic) with a note that finance/staff land once M1 (rechten-hygiëne)
  // lands. That's now: canSeeAnyRequests adds finance (read-only inbox) and
  // staff (own-status view) on top of the same organizer signal.
  const showRequestsNavItem = canManageTemplates || canSeeAnyRequests(roles);
  const navItems: ShellNavItem[] = [
    { key: 'start', section: 'main', label: t.nav.home, icon: 'grid', active: currentKey === 'start', onClick: () => nav.setTab('start') },
    { key: 'events', section: 'main', label: t.nav.events, icon: 'cal', active: currentKey === 'events', onClick: () => nav.setTab('events') },
    { key: 'guests', section: 'main', label: t.nav.guests, icon: 'user', active: currentKey === 'guests', onClick: () => nav.setTab('guests') },
    ...(canViewContacts
      ? ([{ key: 'contacten', section: 'main', label: t.nav.contacts, icon: 'contact', active: currentKey === 'contacten', onClick: () => nav.push('contacten') }] as ShellNavItem[])
      : []),
    ...(showDoor
      ? ([{ key: 'deur', section: 'main', label: t.nav.door, icon: 'door', active: currentKey === 'deur', onClick: () => nav.setTab('deur') }] as ShellNavItem[])
      : []),
    ...(showRequestsNavItem
      ? ([{ key: 'aanvragen', section: 'more', label: t.nav.requests, icon: 'inbox', active: currentKey === 'aanvragen', onClick: () => nav.push('aanvragen'), badge: openRequestCount }] as ShellNavItem[])
      : []),
    ...(canViewStats
      ? ([{ key: 'stats', section: 'more', label: t.nav.analytics, icon: 'spark', active: currentKey === 'stats', onClick: () => nav.push('stats') }] as ShellNavItem[])
      : []),
    ...(canViewStats
      ? ([{ key: 'promo', section: 'more', label: t.nav.promotion, icon: 'link', active: currentKey === 'promo', onClick: () => nav.push('promo') }] as ShellNavItem[])
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

  // Door branch, desktop (≥1024px): the Event-dag cockpit (T9 fold — this was the
  // standalone /eventday route until it lost the app menu; now it lives inside the
  // shell). Online-only by design (no outbox): reads via React Query + realtime,
  // check-in through the door gateway — exactly as /eventday worked. The event
  // choice rides on the `?event=` query param, so "Check-in" from an event card
  // lands here and a viewport resize keeps the same event.
  const cockpitBranch: ReactNode = (
    <div className="flex h-full flex-col">
      <div className="po-scroll min-h-0 flex-1 overflow-y-auto px-[38px] pb-7 pt-[30px]">
        <EventDayCockpitGate
          chosenId={doorEventIdFromUrl}
          onChoose={(id) => guarded(() => router.replace(doorPath({ seg: 'deur', eventId: id })))}
        />
      </div>
    </div>
  );

  // Door branch, mobile: mount the real DoorProvider (offline outbox + realtime)
  // for the venue's current event and render the shared door components. Kept
  // mounted across Deur↔Taken (both are door tabs) so realtime/cache survive the
  // switch; unmounts when leaving for another tab. No event resolvable → empty state.
  // doorState, not doorSeg/doorOverlay — override-aware (only ever reached on
  // mobile, where a raw-history override may be active).
  const doorTitle = doorState.seg === 'taken' ? t.door.tasksTitle : t.door.checkinTitle;
  let doorBranch: ReactNode;
  if (!isMobile) {
    doorBranch = cockpitBranch;
  } else if (resolvedDoorId) {
    doorBranch = (
      <DoorQueryProvider>
        <DoorProvider eventId={resolvedDoorId}>
          <PoDoorTab
            tab={doorState.seg}
            onTab={(seg) => guarded(() => replaceDoorState({ seg, eventId: doorState.eventId, overlay: doorState.overlay }))}
            overlay={doorState.overlay}
            openGuest={openGuest}
            openAdd={openAdd}
            closeOverlay={closeOverlay}
            currentEventName={doorCandidates.length > 1 ? resolvedDoorName : undefined}
            onChangeEvent={
              doorCandidates.length > 1
                ? () => guarded(() => replaceDoorState({ seg: doorState.seg, eventId: null, overlay: doorState.overlay }))
                : undefined
            }
          />
        </DoorProvider>
      </DoorQueryProvider>
    );
  } else if (doorCandidatesQuery.isLoading) {
    doorBranch = <DoorTabState title={doorTitle} text={t.common.loading} />;
  } else if (doorCandidates.length > 1) {
    // Several live/open events and nothing picked yet → choose first (S1.3). The
    // /app shell keeps the bottom-tab menu visible around this picker.
    doorBranch = (
      <DoorEventPicker events={doorCandidates} onPick={(id) => guarded(() => replaceDoorState({ seg: doorState.seg, eventId: id, overlay: null }))} />
    );
  } else {
    doorBranch = <DoorTabState title={doorTitle} text={t.door.noEvent} />;
  }

  // Wide desktop screens (home dashboard, guest table, stats charts, audit table)
  // opt into the full content width; every other screen keeps the reading column.
  // Promotion (S15) is a single centered 760px column by design — between the
  // reading column and the full dashboard width.
  const desktopMainMax =
    activeScreenKey === 'promo'
      ? 'max-w-[820px]'
      : WIDE_DESKTOP.has(activeScreenKey)
        ? 'max-w-[1080px]'
        : 'max-w-[640px]';

  return (
    <PoProvider value={po}>
      <ResponsiveShell
        serverHint={serverHint}
        isTabRoot={tabRoot}
        mobileTab={mobileTab}
        setMobileTab={nav.setTab}
        mobileTabs={mobileTabs}
        // Requests lives under the More hub on mobile, so its open-count rides on
        // the More tab — same source + gate as the desktop sidebar badge (T9).
        mobileBadges={{ meer: showRequestsNavItem ? openRequestCount : 0 }}
        navItems={navItems}
        venueName={liveVenueName ?? t.settings.venueSwitch.thisVenueFallback}
        onOpenVenue={() => nav.push('venueswitch')}
        onOpenProfile={() => nav.push('profile')}
        userName={liveUserName ?? t.common.account}
        userSub={liveUserSub ?? ''}
        mainMaxClass={desktopMainMax}
      >
        {isDoorTab ? doorBranch : body}
      </ResponsiveShell>
    </PoProvider>
  );
}
