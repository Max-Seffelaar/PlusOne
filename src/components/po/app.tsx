'use client';

/**
 * po app shell — a single client tree with real per-screen URLs (G1), rendered
 * through the responsive shell (auth is real middleware + /login + /mfa,
 * outside this tree). Events / Gastenlijst / adresboek read
 * live Supabase data; the Deur/Taken tabs mount the real DoorProvider (offline
 * outbox + realtime), so there is no in-memory door state here anymore.
 */
import { type JSX, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { setTag as sentrySetTag, addBreadcrumb as sentryAddBreadcrumb } from '@/lib/observability/sentry-client';
import { useTransientValue } from '@/lib/use-transient-value';
import {
  usePoCanManageTemplates,
  usePoDoorCandidates,
  usePoEvents,
  usePoGuestRequests,
  usePoIsDoorOrganizer,
} from '@/features/po/hooks';
import { isOpenGuestRequest } from '@/features/po/adapters';
import { autoOpenDoorEvent } from '@/features/po/door-event';
import { poKeys } from '@/features/po/keys';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useAppShellData } from './app-shell-data';
import { canSeeAnyRequests, canWorkDoor } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { DoorProvider } from '@/features/door/DoorProvider';
import { DoorQueryProvider } from '@/features/door/DoorQueryProvider';
import { switchActiveVenueAction } from '@/features/venues/actions';
import { PoProvider, type Nav, type PoApp, type ScreenName, type ScreenProps } from './context';
import { doorPath, parseAppUrl, screenPath, tabPath, type DoorSeg, type ParsedTarget } from './routes';
import { useDoorOverride } from './use-door-override';
import { Toast, type TabKey } from './shell';
import { Top } from './kit';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { useViewport } from './use-viewport';
import { EventDaySkeleton } from '@/features/po/eventday/EventDaySkeleton';
import { Crew, EventEdit, EventView, Events, PastEvent, Tiers } from './screens/events';
import { BulkPaste, Contacten, ContactProfile, GuestsTab } from './screens/guests';
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
const EventLinks = dynamic(() => import('./screens/promotion/event-links').then((m) => m.EventLinks), {
  loading: ScreenLoading,
  ssr: false,
});
const PromotionHub = dynamic(() => import('./screens/promotion').then((m) => m.PromotionHub), {
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
// QuickAdd (#2b): the guest quick-add flow carries the parser + dedupe engine and
// (via the lazy phone field) the country picker — heavy and only ever reached by
// tapping "add guest", never on the door-only / common path. Split into its own
// chunk. Imported from the leaf module (not the guests barrel) so the common
// GuestsTab chunk doesn't drag it back in.
const QuickAdd = dynamic(() => import('./screens/guests/quick-add').then((m) => m.QuickAdd), {
  loading: ScreenLoading,
  ssr: false,
});

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
    case 'promotion':
      return 'promotion';
    case 'gebruikers':
      return 'gebruikers';
    default:
      // rollen, import, venueswitch, venuesettings, venuecreate, profile,
      // billing, audit, adminsessions, templates, templateedit — all live
      // under the More hub on both mobile and desktop.
      return 'meer';
  }
}

/** Mobile only has 5 real bottom tabs — collapse every desktop-only sidebar
 *  entry (Contacts/Requests/Analytics/Promotion/Team) onto "Meer", matching
 *  where those screens actually live in the mobile nav. */
const MOBILE_TABS: ReadonlySet<string> = new Set(['start', 'events', 'guests', 'deur', 'meer']);

/** How long a venue-switch error stays up. Longer than the 4s billing toast:
 *  both strings ask the user to DO something (refresh, retry), so they have to
 *  outlast a glance (86eykm7rk). */
const TOAST_ERROR_MS = 6000;
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
  const searchParamsStr = searchParams.toString();
  // The live URL IS the nav state (G1) — no in-memory stack, no sessionStorage
  // restore-after-refresh hack. Memoized (86ey9e9vc) so `nav`/`po` below stay
  // dep-array-stable (Templates' effect) and, after fix #3, so the door
  // subtree can bail via element-identity — see docs/changelog.md for the
  // full re-render-scope analysis (what this memo does and doesn't stop).
  const target = useMemo(
    // A plain `URLSearchParams(searchParamsStr)` satisfies `parseAppUrl`
    // (routes.ts only calls `.get(...)` on it) and keys the memo off the
    // tracked STRING instead of Next's possibly-fresh `searchParams` object.
    () => parseAppUrl(pathname, new URLSearchParams(searchParamsStr)),
    [pathname, searchParamsStr],
  );
  const doorSeg = target.kind === 'door' ? target.seg : 'deur';
  const doorEventIdFromUrl = target.kind === 'door' ? target.eventId : null;
  const doorOverlay: DoorOverlay = target.kind === 'door' ? target.overlay : null;

  // Door sub-state override (G1 fresh-review fix). Door sub-nav (guest/add
  // overlay, Deur↔Taken segment, event override) is driven through raw
  // `window.history.pushState/replaceState` (`pushDoorState`/`replaceDoorState`
  // below) to keep the door's offline invariant (#25) — `router.push`/`replace`
  // on this dynamic route forces a server RSC round-trip on any search-param
  // change. Since Next's `usePathname`/`useSearchParams` don't track those raw
  // History calls, this override shadows the URL-derived door fields until the
  // URL becomes authoritative again; the hook owns exactly when to drop it (a
  // genuine router nav OR any browser back/forward — see use-door-override.ts,
  // where the back/forward case fixes 86ey9tq62). Desktop's cockpit is
  // unaffected (online-only by design, no outbox, never sets this override).
  const [doorOverride, setDoorOverride] = useDoorOverride(pathname, searchParamsStr);
  // Memoized for the same reason as `target` above — `doorOverride` is a real
  // useState value (stable reference when untouched), so this only produces a
  // new object when one of its actual inputs changed.
  const doorState = useMemo(
    () => doorOverride ?? { seg: doorSeg, eventId: doorEventIdFromUrl, overlay: doorOverlay },
    [doorOverride, doorSeg, doorEventIdFromUrl, doorOverlay],
  );

  // Sticky toasts: cleared by whoever set them. `t.venue.switching` lives here
  // because the reload, not a timer, is what ends it.
  const [toast, setToast] = useState<string | null>(null);
  // Self-clearing toasts go through the shared primitive (86eykm7rk). It is the
  // codebase's answer to exactly the stacking bug a bare `setTimeout` in a
  // promise callback causes — `trigger` cancels the pending timer before arming
  // a new one, and a trigger landing after unmount is a no-op, which matters
  // when the toast is armed from an async completion. Same hook as
  // DoorProvider, home.tsx and the cockpit.
  const [transientToast, showTransientToast, clearTransientToast] = useTransientValue<string>(TOAST_ERROR_MS);
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
  // Door roles (admin / doorhost) see the Deur/Taken tabs — staff/finance/
  // user_manager can't read check_ins/refusals (#17), so the door would look
  // empty/"mock" for them. An event-organizer with no venue role also gets the
  // tab, scoped to their own event(s): RLS (`can_check_in`) already lets them
  // work the door, they just had no in-app route to it before (M2, K-6) —
  // `/door/[eventId]` still works too, but is no longer the only way in.
  const isDoorOrganizer = usePoIsDoorOrganizer();
  const showDoor = canWorkDoor(roles) || isDoorOrganizer;
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
    sentrySetTag('po.screen', activeScreenKey);
    sentryAddBreadcrumb({ category: 'navigation', message: activeScreenKey, level: 'info' });
  }, [activeScreenKey]);

  // Contacts desktop-nav gate (T10). Called here (before any early return) so the
  // hook order stays stable; the gate itself is computed with `caps` further down.
  const canManageTemplates = usePoCanManageTemplates();
  // Never undefined — usePoEvents' own stable-empty-array fallback
  // (86ey9e9vc review, Step 5b; same for usePoDoorCandidates' `.data` below).
  const { data: events } = usePoEvents();
  // Non-closed events for the door (live-first). Selection-first (S1.3): an explicit
  // pick (doorEventIdFromUrl, the `?event=` on the door URL, set by "Check-in" from
  // an event card) wins; with exactly one candidate we use it; with several, the
  // user chooses — no auto-pick guess. Only the chosen event's guests are ever
  // loaded, so dozens of live events stay cheap.
  const doorCandidatesQuery = usePoDoorCandidates();
  const doorCandidates = doorCandidatesQuery.data;
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
  // The verdict that retry produces, published as state (86eykm7qp round 2): the
  // id whose absence survived its own refetch, so the candidate list has now
  // REJECTED it against a freshly fetched list rather than merely a stale
  // snapshot. The pin effect below releases on this and nothing else.
  //
  // State, not a ref, and deliberately so. The release must never be decided on
  // the same commit that issues the refetch — effects in one component run in
  // declaration order, so a ref written here would already be readable by the
  // pin effect below, which would then drop a pin whose event the retry is
  // about to bring back (an explicit "Check-in" pick for an event a colleague
  // created seconds ago is exactly that case). A state update forces a later
  // render, so "issued" and "confirmed" cannot collapse into one commit.
  //
  // Per mount, and that is the point: it is re-derived from the candidate list
  // on every mount, so it is still there after a reload — unlike the round-1
  // `pinnedDoorRef`, which recorded who had chosen an id and therefore knew
  // nothing on the fresh mount where a URL-persisted pin needed releasing.
  const [rejectedDoorId, setRejectedDoorId] = useState<string | null>(null);
  useEffect(() => {
    if (!requestedDoorId || doorCandidatesQuery.isLoading || doorCandidatesQuery.isFetching) return;
    if (doorCandidates.some((e) => e.id === requestedDoorId)) {
      // Present after all (or back again) — clear any standing rejection.
      setRejectedDoorId((prev) => (prev === null ? prev : null));
      return;
    }
    if (staleDoorRefetchRef.current === requestedDoorId) {
      // Retry already spent for this id and `isFetching` is false again, so this
      // is the settled list: the rejection is now confirmed.
      setRejectedDoorId((prev) => (prev === requestedDoorId ? prev : requestedDoorId));
      return;
    }
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
  const guarded = useCallback((apply: () => void): void => {
    if (navGuard.current) return;
    navGuard.current = true;
    queueMicrotask(() => {
      navGuard.current = false;
    });
    apply();
  }, []);

  const pushUrl = useCallback(
    (url: string): void => {
      hasPushedThisSession = true;
      router.push(url);
    },
    [router],
  );

  // Mobile door sub-nav (guest/add overlay, Deur↔Taken segment, event
  // override) — raw History API, entirely bypassing `router.push/replace`
  // (see the `doorOverride` comment above for why). `pushDoorState` marks a
  // real poppable entry same as `pushUrl`; `replaceDoorState` doesn't, same
  // as a plain `router.replace`.
  type DoorState = { seg: DoorSeg; eventId: string | null; overlay: DoorOverlay };
  const pushDoorState = useCallback(
    (next: DoorState): void => {
      hasPushedThisSession = true;
      setDoorOverride(next);
      window.history.pushState(window.history.state, '', doorPath(next));
    },
    [setDoorOverride],
  );
  const replaceDoorState = useCallback(
    (next: DoorState): void => {
      setDoorOverride(next);
      window.history.replaceState(window.history.state, '', doorPath(next));
    },
    [setDoorOverride],
  );

  // Pin the implicit single-candidate door choice (86eykm7qp). `requestedDoorId`
  // above only DERIVES it from `doorCandidates.length === 1` and never writes it
  // back, so it was recomputed every render: the moment a second event went live
  // mid-shift — React Query's `refetchOnReconnect` default refires the candidate
  // query after any wifi hiccup, and `PoLiveProvider` doesn't disable it — the id
  // flipped to null, `<DoorEventPicker>` took `<DoorQueryProvider>`'s place in the
  // same slot, and React unmounted the entire door tree, tearing down
  // `useDoorSync`'s realtime channel in the middle of a check-in. Writing the
  // choice through `replaceDoorState` lands it in `doorOverride` AND the raw URL
  // with no router round-trip, so the door's offline invariant (#25) is untouched
  // and a growing candidate list can no longer unmount the door.
  // Mobile door tab only: the desktop cockpit resolves its own event and must
  // never carry an override, and firing this off the door tab would rewrite the
  // URL to a door path under an unrelated screen.
  //
  // Both halves are derived from CURRENT state, never from a memory of what this
  // mount has written before (round-2 review of #278). The round-1 version used a
  // `pinnedDoorRef` for both jobs and leaked at both ends, because a ref and the
  // URL have different lifetimes:
  //  - The write guard asks "is the state already what I would write?", not "have
  //    I ever written this?". `doorState.eventId` returns to null WITHOUT a
  //    remount — `useDoorOverride`'s popstate listener drops the override on any
  //    back/forward (86ey9tq62), and a door entered from the bottom tab has no
  //    `?event=` in Next's tracked search string to fall back to. A sticky ref
  //    refused the re-pin there, so one hardware-back out of a guest overlay —
  //    the door's most common gesture — restored the original bug. Comparing
  //    against `doorState.eventId` is self-healing: after the write the state IS
  //    the value, so the effect stops on its own (still exactly one write per
  //    mount, zero on idle re-renders).
  //  - The release fires on `rejectedDoorId`, the candidate list's own settled
  //    verdict, so it needs no memory of who chose the id. That is what makes it
  //    work on a FRESH mount: the pin survives a reload (it is in the URL) but a
  //    ref does not, so a tablet reloading last night's pinned URL used to land
  //    on "geen event" with no picker (only >1 candidates renders one) and no way
  //    out. It also means a stale EXPLICIT `?event=` is now released the same
  //    way — deliberate: `resolvedDoorId` already refuses to mount the door for a
  //    non-candidate, so that id was only ever stranding the host.
  useEffect(() => {
    if (!isMobile || !isDoorTab) return;
    if (doorState.eventId !== null) {
      // Re-check the list here too: `rejectedDoorId` is state, so on the commit
      // where the effect above clears it this still reads the previous value.
      if (
        rejectedDoorId === doorState.eventId &&
        !doorCandidates.some((e) => e.id === doorState.eventId)
      ) {
        replaceDoorState({ seg: doorState.seg, eventId: null, overlay: doorState.overlay });
      }
      return;
    }
    if (resolvedDoorId === null) return;
    replaceDoorState({ seg: doorState.seg, eventId: resolvedDoorId, overlay: doorState.overlay });
  }, [
    isMobile,
    isDoorTab,
    doorState.eventId,
    doorState.seg,
    doorState.overlay,
    resolvedDoorId,
    rejectedDoorId,
    doorCandidates,
    replaceDoorState,
  ]);

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
    // `doorCandidatesQuery.data` is never undefined (usePoDoorCandidates'
    // stable-empty-array fallback, 86ey9e9vc) — an undefined-ness check here
    // can no longer distinguish "still loading" from "loaded, zero events",
    // so this used to consume the one-shot evaluation on the FIRST render
    // (candidates still loading, `cands` already `[]`) with nothing to open,
    // permanently arming the sessionStorage flag before the real candidate
    // list ever arrived — the auto-open silently never fired (review round
    // 2, Blocker 2). Gate on the query's own success state instead.
    if (!doorCandidatesQuery.isSuccess) return; // wait for candidates before consuming the one evaluation
    const cands = doorCandidatesQuery.data;
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
  }, [isMobile, showDoor, doorCandidatesQuery.isSuccess, doorCandidatesQuery.data, userId, target]);

  const doorOverlayOpen = isDoorTab && doorState.overlay !== null;

  // Memoized (86ey9e9vc): `nav`'s identity now only changes on real
  // navigation, not on every PlusOneApp render — see the `target` comment
  // above for what this does and doesn't buy.
  const nav: Nav = useMemo(
    () => ({
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
    }),
    // Member-level dep, not the whole `doorState` object (86ey9e9vc review,
    // 2b): the body above only ever reads `doorState.overlay` — depending on
    // the whole object meant every door sub-nav (Deur↔Taken, event switch)
    // minted a new `doorState` → new `nav` → new `po` value, defeating the
    // stability this memo exists to provide on exactly the surface it targets.
    [target, doorState.overlay, router, guarded, pushUrl],
  );

  // Door-overlay navigation (Deur/Taken tabs): opening the overlay is a forward
  // step (it hides the tab bar like a pushed screen) — a real history entry, so
  // the physical back button and the overlay's own close button share one path.
  // Raw history (pushDoorState), not pushUrl/router.push — see doorOverride.
  // useCallback (86ey9e9vc review, fix #3): these are handed to `<PoDoorTab>`
  // as props — stable references are what let the memoized element below
  // actually bail the door subtree (SyncBar, the virtualized CheckInList, ...)
  // on an unrelated PlusOneApp re-render.
  const openGuest = useCallback(
    (id: string): void =>
      guarded(() => pushDoorState({ seg: doorState.seg, eventId: doorState.eventId, overlay: { kind: 'guest', id } })),
    [guarded, pushDoorState, doorState],
  );
  const openAdd = useCallback(
    (): void => guarded(() => pushDoorState({ seg: doorState.seg, eventId: doorState.eventId, overlay: { kind: 'add' } })),
    [guarded, pushDoorState, doorState],
  );
  // Same cold-deep-link fallback as nav.back() — a directly-linked overlay
  // (e.g. a shared door URL) has no history to pop either. `replace`, not
  // `pushUrl`, for the same non-latching reason as `nav.back()` above.
  const closeOverlay = useCallback(
    (): void => guarded(() => (hasPushedThisSession ? router.back() : router.replace(parentPathFor(target)))),
    [guarded, router, target],
  );

  // Switch the ACTIVE venue for real (#1): write the server cookie, then full-reload
  // so app/page.tsx re-resolves the identity and every live query re-scopes to the
  // new venue. (Local state alone can't re-scope server-resolved identity.)
  const switchToVenue = useCallback(
    (venueId: string): void => {
      // A no-op for the already-active venue (context.tsx) — unreachable from
      // the UI today, kept as a guard since this is public API (86ey9e9vc).
      if (venueId === activeVenueId) return;
      // A fresh attempt drops the previous attempt's error: leaving it up would
      // render over "Switching…" and read as if the new tap had failed too.
      clearTransientToast();
      setToast(t.venue.switching); // sticky: the reload, not a timer, ends this one
      void switchActiveVenueAction(venueId)
        .then((result) => {
          // The server can REFUSE the switch without throwing (86eykm7rk): an
          // admin revoking the access between the render of `myVenues` and
          // this tap leaves the cookie unwritten. Reloading then drops the user
          // back on the OLD venue with no error and no way out, so 'denied' has
          // to say so instead. 'unauthenticated' still reloads on purpose —
          // middleware turns that into /login, which is where the user belongs.
          if (result === 'denied') {
            setToast(null);
            showTransientToast(t.venue.switchFailed);
            return;
          }
          window.location.assign('/app');
        })
        .catch(() => {
          // A thrown action (network blip, 500) has to speak too. Clearing the
          // toast here was the SAME silent failure this task exists to remove,
          // just via a different path: "Switching…" flashed, the venue never
          // changed, and nothing said why. Deliberately NOT `switchFailed` —
          // the user's access is fine, so "try again" is the honest advice.
          setToast(null);
          showTransientToast(t.venue.switchError);
        });
    },
    [activeVenueId, showTransientToast, clearTransientToast],
  );

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
        // ScreenProps.tab is shared with the Promotion hub — narrow to aanvragen's own queues.
        screen = <Aanvragen eventId={p.id} initialTab={p.tab === 'landing' || p.tab === 'quota' ? p.tab : undefined} />;
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
        screen = <EventLinks eventId={p.id} />;
        break;
      case 'promotion':
        screen = <PromotionHub tab={p.tab} eventId={p.id} />;
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

  // Memoized (86ey9e9vc) — same shape and caveats as `target`/`nav` above.
  const po: PoApp = useMemo(
    () => ({
      statsVenues: statsAccess?.venues ?? [],
      myVenues,
      activeVenueId,
      switchToVenue,
      nav,
      isMobile,
    }),
    [statsAccess, myVenues, activeVenueId, switchToVenue, nav, isMobile],
  );

  const body = (
    <>
      <div key={key} className="po-screen-anim flex min-h-0 flex-1 flex-col">
        {screen}
      </div>
      {/* A self-clearing toast wins over a sticky one: the only overlap is a
          venue switch, where the error REPLACES "Switching…". */}
      {(transientToast ?? toast) && <Toast>{transientToast ?? toast}</Toast>}
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
      ? ([{ key: 'promotion', section: 'more', label: t.nav.promotion, icon: 'link', active: currentKey === 'promotion', onClick: () => nav.push('promotion') }] as ShellNavItem[])
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
  const hasMultipleDoorCandidates = doorCandidates.length > 1;
  // useCallback (86ey9e9vc review, fix #3) — these were inline arrows before,
  // a NEW closure every PlusOneApp render, which alone would defeat the
  // element memo below no matter how stable everything else was.
  const onDoorTab = useCallback(
    (seg: DoorSeg) => guarded(() => replaceDoorState({ seg, eventId: doorState.eventId, overlay: doorState.overlay })),
    [guarded, replaceDoorState, doorState],
  );
  const onChangeDoorEvent = useCallback(
    () => guarded(() => replaceDoorState({ seg: doorState.seg, eventId: null, overlay: doorState.overlay })),
    [guarded, replaceDoorState, doorState],
  );
  // Memoized element (86ey9e9vc, fix #3): a stable reference here is what lets
  // `DoorProvider`/`DoorQueryProvider` (which just forward `children`) bail
  // React out of re-rendering PoDoorTab on an unrelated PlusOneApp render —
  // structural, not context-based, so it's necessary but NOT sufficient on
  // its own (PoDoorTab still directly subscribes to a couple of DoorProvider
  // contexts; see DoorToastContext's comment). Structural half verified in
  // tests/unit/door-tab-element-identity-bailout.test.ts; the context half in
  // DoorProvider.test.tsx.
  const doorTabElement = useMemo(
    () =>
      resolvedDoorId ? (
        <PoDoorTab
          tab={doorState.seg}
          onTab={onDoorTab}
          overlay={doorState.overlay}
          openGuest={openGuest}
          openAdd={openAdd}
          closeOverlay={closeOverlay}
          currentEventName={hasMultipleDoorCandidates ? resolvedDoorName : undefined}
          onChangeEvent={hasMultipleDoorCandidates ? onChangeDoorEvent : undefined}
        />
      ) : null,
    [
      resolvedDoorId,
      doorState.seg,
      onDoorTab,
      doorState.overlay,
      openGuest,
      openAdd,
      closeOverlay,
      hasMultipleDoorCandidates,
      resolvedDoorName,
      onChangeDoorEvent,
    ],
  );
  let doorBranch: ReactNode;
  if (!isMobile) {
    doorBranch = cockpitBranch;
  } else if (resolvedDoorId) {
    doorBranch = (
      <DoorQueryProvider>
        <DoorProvider eventId={resolvedDoorId}>{doorTabElement}</DoorProvider>
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
    activeScreenKey === 'promotion'
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
