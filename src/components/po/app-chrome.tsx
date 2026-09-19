'use client';

/**
 * The po shell's chrome: sidebar/bottom-tab nav, the venue switcher, the toasts,
 * and the `po` context every screen reads.
 *
 * Extracted from `app.tsx` (86eykm76k). Like `AppScreens`, this is not only a
 * file-size move: it reads `usePoGuestRequests()` (the open-requests badge) and
 * `usePoCanManageTemplates()`, and it owns the toast state. All three used to
 * live in the shell root, where every badge tick and every toast rebuilt the
 * root's whole element tree — including the door's. Here they re-render the
 * chrome only; `children` is an element the root did not rebuild, so React
 * bails on the door subtree without any memo helping it.
 *
 * `navItems` is memoized for the reason the efficiency review called out: ~10
 * objects and ~10 closures, handed to an unmemoized `ResponsiveShell`, rebuilt
 * on every single render. It now rebuilds only when something in it changed.
 */
import { useCallback, useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTransientValue } from '@/lib/use-transient-value';
import { usePoCanManageTemplates, usePoGuestRequests } from '@/features/po/hooks';
import { isOpenGuestRequest } from '@/features/po/adapters';
import { poKeys } from '@/features/po/keys';
import { canSeeAnyRequests, type VenueRole } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import { switchActiveVenueAction } from '@/features/venues/actions';
import { PoProvider, type Nav, type PoApp } from './context';
import type { ParsedTarget } from './routes';
import { navKeyForScreen, mobileTabForScreen, venueEntryScreen, WIDE_DESKTOP } from './nav-map';
import { Toast, type TabKey } from './shell';
import { ResponsiveShell, type ShellNavItem } from './shell-responsive';
import { useAppShellData } from './app-shell-data';
import { t } from '@/lib/i18n';

/** How long a venue-switch error stays up. Longer than the 4s billing toast:
 *  both strings ask the user to DO something (refresh, retry), so they have to
 *  outlast a glance (86eykm7rk). */
const TOAST_ERROR_MS = 6000;

export function AppShellChrome({
  target,
  nav,
  roles,
  isMobile,
  showDoor,
  isDoorTab,
  doorOverlayOpen,
  entranceKey,
  children,
}: {
  target: ParsedTarget;
  nav: Nav;
  roles: VenueRole[];
  isMobile: boolean;
  showDoor: boolean;
  isDoorTab: boolean;
  doorOverlayOpen: boolean;
  /** Retriggers the CSS entrance animation on every navigation (any URL change). */
  entranceKey: string;
  children: ReactNode;
}): JSX.Element {
  // Server-resolved display data (venue list, stats access, live names) — set
  // once by the /app layout (G1), not re-fetched per screen navigation.
  const { statsAccess, myVenues, activeVenueId, serverHint, liveVenueName, liveUserName, liveUserSub } =
    useAppShellData();

  // Sticky toasts: cleared by whoever set them. `t.venue.switching` lives here
  // because the reload, not a timer, is what ends it.
  const [toast, setToast] = useState<string | null>(null);
  // Self-clearing toasts go through the shared primitive (86eykm7rk). It is the
  // codebase's answer to exactly the stacking bug a bare `setTimeout` in a
  // promise callback causes — `trigger` cancels the pending timer before arming
  // a new one, and a trigger landing after unmount is a no-op, which matters
  // when the toast is armed from an async completion.
  const [transientToast, showTransientToast, clearTransientToast] = useTransientValue<string>(TOAST_ERROR_MS);

  // Stripe Checkout return (fase 13, #32): the hosted checkout redirects back to
  // /app?billing=success|canceled. Strip the flag from the URL immediately (a
  // refresh must not re-toast) and park it in sessionStorage with a timestamp
  // rather than jumping straight to `setToast`. The parking originally existed
  // because the shell remounted while identity/live data settled, which wiped a
  // plain useState toast set on the first mount; since 86ey9uc87 the shell
  // mounts once, so the same mount now reads its own parked flag straight back.
  // Keeping the round-trip is still the right call: it costs nothing, and it is
  // what makes the toast survive the strip-and-replaceState above plus any
  // reload/remount the return path can still produce (auth refresh, venue
  // switch).
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
          // toast here was the SAME silent failure 86eykm7rk exists to remove,
          // just via a different path: "Switching…" flashed, the venue never
          // changed, and nothing said why. Deliberately NOT `switchFailed` —
          // the user's access is fine, so "try again" is the honest advice.
          setToast(null);
          showTransientToast(t.venue.switchError);
        });
    },
    [activeVenueId, showTransientToast, clearTransientToast],
  );

  // Memoized: this is CONTEXT, so a new value re-renders every consumer
  // regardless of element identity — the one place where a memo is still doing
  // structural work rather than papering over a re-render.
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

  // Open-requests count for the nav badge (desktop sidebar + mobile More). Reuses
  // the venue-wide guest-requests query that Home already loads (shared React
  // Query key → no extra polling); OPEN = pending only, the shared definition, so
  // this badge matches Home's tile and the event-card badge exactly (T9).
  const openRequestCount = (usePoGuestRequests().data ?? []).filter(isOpenGuestRequest).length;
  // Contacts desktop-nav gate (T10).
  const canManageTemplates = usePoCanManageTemplates();

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
  // NO nav route and could only reach the inbox via Home's tiles (K-5). M5 (8/7)
  // unified this gate across the More hub / sidebar / Home tiles as "admin or an
  // organizer-at-this-venue" (`canManageTemplates`, a real fetchOrganizesAtVenue
  // query — not a roles-array heuristic); canSeeAnyRequests adds finance
  // (read-only inbox) and staff (own-status view) on top of the same signal.
  const showRequestsNavItem = canManageTemplates || canSeeAnyRequests(roles);
  const canViewTeam = caps.viewTeam;
  // One venue + may see its settings: the venue card opens them, not a
  // one-item switcher (z8uq9m0hw2).
  const venueEntry = venueEntryScreen(myVenues.length, caps.viewSettings);

  const navItems: ShellNavItem[] = useMemo(
    () => [
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
      ...(canViewTeam
        ? ([{ key: 'gebruikers', section: 'more', label: t.nav.team, icon: 'users', active: currentKey === 'gebruikers', onClick: () => nav.push('gebruikers') }] as ShellNavItem[])
        : []),
      { key: 'meer', section: 'more', label: t.nav.more, icon: 'dots', active: currentKey === 'meer', onClick: () => nav.setTab('meer') },
    ],
    [currentKey, nav, canViewContacts, showDoor, showRequestsNavItem, openRequestCount, canViewStats, canViewTeam],
  );

  // Mobile bottom tabs — non-door roles drop Deur/Taken (default would show all).
  const mobileTabs: TabKey[] = useMemo(
    () => (showDoor ? ['start', 'events', 'guests', 'deur', 'meer'] : ['start', 'events', 'guests', 'meer']),
    [showDoor],
  );
  const mobileBadges = useMemo(
    // Requests lives under the More hub on mobile, so its open-count rides on
    // the More tab — same source + gate as the desktop sidebar badge (T9).
    () => ({ meer: showRequestsNavItem ? openRequestCount : 0 }),
    [showRequestsNavItem, openRequestCount],
  );

  const activeScreenKey: string =
    target.kind === 'screen' ? target.name : target.kind === 'door' ? 'deur' : target.tab;
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
        // Tab bar is always visible when authenticated, even on pushed/detail
        // screens. Door overlays (in-tab check-in detail) are the only exception
        // — they run full-screen within the Deur tab.
        isTabRoot={!doorOverlayOpen}
        mobileTab={mobileTab}
        setMobileTab={nav.setTab}
        mobileTabs={mobileTabs}
        mobileBadges={mobileBadges}
        navItems={navItems}
        venueName={liveVenueName ?? t.settings.venueSwitch.thisVenueFallback}
        venueOpensSettings={venueEntry === 'venuesettings'}
        onOpenVenue={() => nav.push(venueEntry)}
        onOpenProfile={() => nav.push('profile')}
        userName={liveUserName ?? t.common.account}
        userSub={liveUserSub ?? ''}
        mainMaxClass={desktopMainMax}
      >
        {isDoorTab ? (
          children
        ) : (
          <>
            <div key={entranceKey} className="po-screen-anim flex min-h-0 flex-1 flex-col">
              {children}
            </div>
            {/* A self-clearing toast wins over a sticky one: the only overlap is a
                venue switch, where the error REPLACES "Switching…". */}
            {(transientToast ?? toast) && <Toast>{transientToast ?? toast}</Toast>}
          </>
        )}
      </ResponsiveShell>
    </PoProvider>
  );
}
