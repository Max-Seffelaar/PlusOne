'use client';

/**
 * po app shell — a single client tree with real per-screen URLs (G1), rendered
 * through the responsive shell (auth is real middleware + /login + /mfa,
 * outside this tree).
 *
 * This file is the ROOT only: it derives the active target from the URL, owns
 * the door's raw-history sub-state, builds `nav`, and composes three siblings —
 * `AppShellChrome` (nav/toasts/context), `AppScreens` (everything that is not
 * the door) and `PoDoorBranch` (the door). Every live data read lives in one of
 * those three, never here.
 *
 * That split is the point, not a tidy-up (86eykm76k). While the root read
 * `usePoEvents` / `usePoDoorCandidates` / `usePoGuestRequests`, any of those
 * refetching rebuilt the root's whole element tree, so the door subtree had to
 * be defended with a memoized element, six `useCallback`s and a ten-entry
 * dependency array — a structure where adding a ninth prop to `<PoDoorTab>`
 * silently froze it, with no type error and no lint rule to catch it. Those
 * reads now sit in siblings of the door, so an unrelated refetch cannot reach
 * it at all and the hand-memos are gone. See `door-branch.tsx`.
 */
import { type JSX, useCallback, useEffect, useMemo, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { setTag as sentrySetTag, addBreadcrumb as sentryAddBreadcrumb } from '@/lib/observability/sentry-client';
import { usePoIsDoorOrganizer } from '@/features/po/hooks';
import { usePoIdentity } from '@/features/po/PoLiveProvider';
import { useAppShellData } from './app-shell-data';
import { canWorkDoor } from '@/features/auth/roles';
import { AppShellChrome } from './app-chrome';
import { AppScreens } from './app-screens';
import { DesktopDoorAutoOpen, PoDoorBranch, type DoorNav } from './door-branch';
import { type Nav, type ScreenName } from './context';
import { doorPath, parseAppUrl, screenPath, tabPath, type DoorSeg } from './routes';
import { parentPathFor } from './nav-map';
import { useDoorOverride, type DoorOverrideState } from './use-door-override';
import type { TabKey } from './shell';
import { useViewport } from './use-viewport';
import { useDoorVariant } from './use-door-variant';
import type { DoorOverlay } from './screens/door';

// Tracks whether a real, poppable history entry has been pushed yet THIS
// browser-tab session (e2e-review fix). A cold deep link (fresh tab,
// bookmark, the consent/MFA `next=` round-trip) starts with nothing to pop —
// `router.back()` there would no-op or leave the app. `back()`/`closeOverlay`
// check this before deciding between a real `router.back()` and a computed
// parent path. `router.replace` never sets it: swapping the current entry
// doesn't create anything new to go back to.
//
// MODULE-level, not a `useRef` inside `PlusOneApp`, because module scope is what
// this flag actually means. The question it answers is "does this BROWSER TAB
// have a history entry we may pop?", and history is owned by the tab, not by any
// React instance. `PlusOneApp` still unmounts whenever the user leaves /app for
// a sibling route (`/door/[id]`, `/e/[slug]`, a settings redirect) and remounts
// on the way back — a client-side navigation that pushes real history entries
// while the component is gone. A ref would forget them and send the next
// `back()` down the cold-deep-link branch, silently reintroducing the original
// bug (the e2e core-flow test caught it once already: Back after creating an
// event landed on the event's own detail page instead of the events list) on a
// path the e2e test doesn't cover. A module variable resets only on a genuine
// full page load, which is exactly the "nothing to pop yet" signal this needs.
// Door sub-nav (`pushDoorState`) bypasses `router.push` entirely and sets the
// flag directly.
let hasPushedThisSession = false;

/**
 * Remount probe (86ey9uc87). Counts how often the shell MOUNTS, on `window` so
 * an e2e test can read it across real navigations — the acceptance criterion
 * for that task is a measured 0 remounts, not a subjective "feels faster".
 *
 * Dev/test only: the `NODE_ENV` check is statically replaced at build time, so
 * the whole body folds away in a production build. Kept in the shipped source
 * (rather than being a throwaway) because it is the only cheap way to catch a
 * regression — moving the shell back under `page.tsx`, or introducing a
 * remounting wrapper, is invisible to every other test we have.
 */
function useShellMountProbe(): void {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const w = window as Window & { __poShellMounts?: number };
    w.__poShellMounts = (w.__poShellMounts ?? 0) + 1;
  }, []);
}

export function PlusOneApp(): JSX.Element {
  useShellMountProbe();
  const { serverHint } = useAppShellData();
  // Same breakpoint/source as ResponsiveShell — the chrome only. The door's
  // variant is its own question (decision 14: touch OR <1024px → outbox), picked
  // inside `PoDoorBranch`; read here only to gate the cockpit's auto-open.
  const isMobile = useViewport(serverHint);
  const doorVariant = useDoorVariant();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamsStr = searchParams.toString();
  // The live URL IS the nav state (G1) — no in-memory stack, no sessionStorage
  // restore-after-refresh hack. Memoized so `nav` and the three children below
  // stay reference-stable across a re-render that changed nothing about the URL.
  const target = useMemo(
    // A plain `URLSearchParams(searchParamsStr)` satisfies `parseAppUrl`
    // (routes.ts only calls `.get(...)` on it) and keys the memo off the
    // tracked STRING instead of Next's possibly-fresh `searchParams` object.
    () => parseAppUrl(pathname, new URLSearchParams(searchParamsStr)),
    [pathname, searchParamsStr],
  );
  const doorSeg: DoorSeg = target.kind === 'door' ? target.seg : 'deur';
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
  const doorState: DoorOverrideState = useMemo(
    () => doorOverride ?? { seg: doorSeg, eventId: doorEventIdFromUrl, overlay: doorOverlay },
    [doorOverride, doorSeg, doorEventIdFromUrl, doorOverlay],
  );

  const { userId, roles } = usePoIdentity();
  // Door roles (admin / doorhost) see the Deur/Taken tabs — staff/finance/
  // user_manager can't read check_ins/refusals (#17), so the door would look
  // empty/"mock" for them. An event-organizer with no venue role also gets the
  // tab, scoped to their own event(s): RLS (`can_check_in`) already lets them
  // work the door, they just had no in-app route to it before (M2, K-6) —
  // `/door/[eventId]` still works too, but is no longer the only way in.
  const isDoorOrganizer = usePoIsDoorOrganizer();
  const showDoor = canWorkDoor(roles) || isDoorOrganizer;
  const isDoorTab = showDoor && target.kind === 'door';

  // The active screen/tab key, used for Sentry breadcrumbs. Screen ids are
  // internal constants (PII-free) — never the raw path, which can carry real
  // entity ids.
  const activeScreenKey: string =
    target.kind === 'screen' ? target.name : target.kind === 'door' ? 'deur' : target.tab;
  // Sentry po-screen context (fase 4.2): tag the active screen + a navigation
  // breadcrumb centrally, from the URL-derived key — every push/tab/back/replace
  // flows through the router, so this fires on every real navigation for free.
  useEffect(() => {
    sentrySetTag('po.screen', activeScreenKey);
    sentryAddBreadcrumb({ category: 'navigation', message: activeScreenKey, level: 'info' });
  }, [activeScreenKey]);

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
  const replaceUrl = useCallback((url: string): void => router.replace(url), [router]);

  // Mobile door sub-nav (guest/add overlay, Deur↔Taken segment, event
  // override) — raw History API, entirely bypassing `router.push/replace`
  // (see the `doorOverride` comment above for why). `pushDoorState` marks a
  // real poppable entry same as `pushUrl`; `replaceDoorState` doesn't, same
  // as a plain `router.replace`.
  const pushDoorState = useCallback(
    (next: DoorOverrideState): void => {
      hasPushedThisSession = true;
      setDoorOverride(next);
      window.history.pushState(window.history.state, '', doorPath(next));
    },
    [setDoorOverride],
  );
  const replaceDoorState = useCallback(
    (next: DoorOverrideState): void => {
      setDoorOverride(next);
      window.history.replaceState(window.history.state, '', doorPath(next));
    },
    [setDoorOverride],
  );

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
      setTab: (tab: TabKey) =>
        guarded(() => {
          if (tab === 'deur') {
            // Re-tapping Deur while already on its root (no overlay) is a no-op.
            // Checks doorState (override-aware), not target.overlay — the
            // latter can be stale while a raw-history door override is active.
            if (target.kind === 'door' && doorState.overlay === null) return;
            pushUrl(doorPath());
            return;
          }
          // Re-tapping the current tab at its root is a true no-op.
          if (target.kind === 'tab' && target.tab === tab) return;
          pushUrl(tabPath(tab));
        }),
      // "Check-in" from a specific event: open the Deur tab for THAT event (S1.3).
      openDoor: (eventId: string) => guarded(() => pushUrl(doorPath({ seg: 'deur', eventId }))),
      // A real per-screen URL: every pushed screen has a parent to go back to
      // (a real history entry, or the computed fallback above).
      canGoBack: target.kind === 'screen',
    }),
    // Member-level dep, not the whole `doorState` object: the body above only
    // ever reads `doorState.overlay`, and depending on the whole object meant
    // every door sub-nav (Deur↔Taken, event switch) minted a new `nav` → new
    // `po` CONTEXT value, re-rendering every screen that reads it.
    [target, doorState.overlay, router, guarded, pushUrl],
  );

  // The door's sub-navigation, as ONE permanently stable object.
  //
  // Every handler reads the values it needs out of `latest` at call time instead
  // of capturing them, so this object never has to be rebuilt and therefore
  // needs no dependency array at all. That is deliberate: the door's handlers
  // are what PR #261 had to keep stable with six separate `useCallback`s, and a
  // dependency array is exactly the thing that goes stale silently. Nothing here
  // can go stale, because nothing here is captured — a handler added later gets
  // the same guarantee for free.
  //
  // Handlers only ever run after a commit, so reading the render-scoped values
  // through a ref is safe; `latest` is never read during render.
  const latest = useRef({ target, doorState, guarded, router, pushDoorState, replaceDoorState });
  latest.current = { target, doorState, guarded, router, pushDoorState, replaceDoorState };
  const doorNavRef = useRef<DoorNav>(undefined as unknown as DoorNav);
  if (!doorNavRef.current) {
    const withDoor = (next: Partial<DoorOverrideState>, push = false): void => {
      const { doorState: s, pushDoorState: p, replaceDoorState: r } = latest.current;
      (push ? p : r)({ seg: s.seg, eventId: s.eventId, overlay: s.overlay, ...next });
    };
    doorNavRef.current = {
      // Opening an overlay is a forward step (it hides the tab bar like a pushed
      // screen) — a real history entry, so the physical back button and the
      // overlay's own close button share one path.
      openGuest: (id) => latest.current.guarded(() => withDoor({ overlay: { kind: 'guest', id } }, true)),
      openAdd: () => latest.current.guarded(() => withDoor({ overlay: { kind: 'add' } }, true)),
      // Same cold-deep-link fallback as nav.back() — a directly-linked overlay
      // (e.g. a shared door URL) has no history to pop either. `replace`, not
      // `pushUrl`, for the same non-latching reason as `nav.back()` above.
      closeOverlay: () =>
        latest.current.guarded(() =>
          hasPushedThisSession
            ? latest.current.router.back()
            : latest.current.router.replace(parentPathFor(latest.current.target)),
        ),
      onTab: (seg) => latest.current.guarded(() => withDoor({ seg })),
      onChangeEvent: () => latest.current.guarded(() => withDoor({ eventId: null })),
      onPickEvent: (eventId) => latest.current.guarded(() => withDoor({ eventId, overlay: null })),
      // The implicit single-candidate pin (#278) — written by the door branch
      // itself, straight into `doorOverride` + the raw URL, no router round-trip.
      pinEvent: (eventId) => withDoor({ eventId }),
    };
  }
  const doorNav = doorNavRef.current;

  // The cockpit's own event pick IS a router navigation (desktop is online-only
  // and must never carry a door override).
  const onChooseCockpitEvent = useCallback(
    (eventId: string | null): void => guarded(() => router.replace(doorPath({ seg: 'deur', eventId }))),
    [guarded, router],
  );

  return (
    <>
      <AppShellChrome
        target={target}
        nav={nav}
        roles={roles}
        isMobile={isMobile}
        showDoor={showDoor}
        isDoorTab={isDoorTab}
        doorOverlayOpen={isDoorTab && doorState.overlay !== null}
        entranceKey={`${pathname}?${searchParamsStr}`}
      >
        {isDoorTab ? (
          <PoDoorBranch
            doorState={doorState}
            doorEventIdFromUrl={doorEventIdFromUrl}
            doorNav={doorNav}
            onChooseCockpitEvent={onChooseCockpitEvent}
          />
        ) : (
          <AppScreens target={target} nav={nav} />
        )}
      </AppShellChrome>
      {/* Reads `usePoDoorCandidates` while the user is NOT on the door tab, which
          is the one thing that used to force that query into the shell root.
          Renders nothing. */}
      {doorVariant === 'cockpit' && showDoor && (
        <DesktopDoorAutoOpen
          userId={userId}
          isStartTab={target.kind === 'tab' && target.tab === 'start'}
          replaceUrl={replaceUrl}
        />
      )}
    </>
  );
}
