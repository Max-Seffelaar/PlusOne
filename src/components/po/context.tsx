'use client';

/**
 * Navigation + shared app state for the po surface. Holds the in-memory nav stack
 * and the active venue. The door check-in state used to live here too; it now
 * comes from the real DoorProvider (TanStack Query + offline outbox + realtime)
 * under the Deur/Taken tabs, so it is no longer duplicated here (#25).
 */
import { createContext, useContext } from 'react';
import type { TabKey } from './shell';
import type { Venue } from '@/lib/po/types';
import type { VenueRole } from '@/features/auth/roles';

export type ScreenName =
  | 'event'
  | 'lijst'
  | 'guest'
  | 'contacten'
  | 'contactprofile'
  | 'vaste'
  | 'rollen'
  | 'import'
  | 'quickadd'
  | 'bulk'
  | 'aanvragen'
  | 'eventedit'
  | 'tiers'
  | 'gebruikers'
  | 'pastevent'
  | 'venueswitch'
  | 'venuesettings'
  | 'venuecreate'
  | 'profile'
  | 'billing'
  | 'allowance'
  | 'eventbeheer'
  | 'stats'
  | 'audit'
  | 'adminsessions'
  | 'templates'
  | 'templateedit';

export interface ScreenProps {
  id?: string;
  /** Event scope for the guest detail (props.id there is the guest id). */
  eventId?: string;
  isNew?: boolean;
  /** Approvals (aanvragen) deep-link: which queue to open first. */
  tab?: 'landing' | 'quota';
}

export interface StackEntry {
  name: ScreenName;
  props: ScreenProps;
}

export interface Nav {
  push: (name: ScreenName, props?: ScreenProps) => void;
  back: () => void;
  setTab: (t: TabKey) => void;
  /** Open the Deur tab for a SPECIFIC event (S1.3) — "Check-in" from an event card
   *  must land on that event's door, not the venue-wide auto-pick. */
  openDoor: (eventId: string) => void;
}

export type AuthView = 'welcome' | 'login' | 'otp' | 'mfa' | 'invite';

export interface AuthNav {
  go: (v: AuthView, props?: { email?: string }) => void;
  start: () => void;
}

/** A venue the signed-in user belongs to (live membership), for the switcher (#1). */
export interface PoVenueMembership {
  venueId: string;
  venueName: string;
  roles: VenueRole[];
}

export interface PoApp {
  venue: Venue;
  switchVenue: (v: Venue) => void;
  statsVenues: { venueId: string; venueName: string }[];
  /** The caller's real venue memberships (live) — drives the venue switcher. */
  myVenues: PoVenueMembership[];
  /** The active (cookie-resolved) venue id, or null. */
  activeVenueId: string | null;
  /** Switch the active venue server-side (cookie) + full reload, so every live
   *  query re-scopes to the new venue (#1). A no-op for the already-active venue. */
  switchToVenue: (venueId: string) => void;
  nav: Nav;
}

const PoContext = createContext<PoApp | null>(null);

export const PoProvider = PoContext.Provider;

export function usePo(): PoApp {
  const v = useContext(PoContext);
  if (!v) throw new Error('usePo must be used within PoProvider');
  return v;
}

export function useNav(): Nav {
  return usePo().nav;
}

// ── Nav-state persistence (S3.2) ─────────────────────────────────────────────
// The po nav stack is in-memory, so a browser refresh used to drop you back on
// Start. We persist the current tab + stack to sessionStorage (survives reload,
// clears on tab-close) so a refresh keeps you on the same screen. Capacitor-safe
// (#37): sessionStorage works in native webviews, and every access is guarded so
// a missing/blocked store just degrades to the old in-memory behaviour.

const NAV_STORAGE_KEY = 'po:nav-state';
const PERSISTED_TABS: readonly TabKey[] = ['start', 'events', 'guests', 'deur', 'meer'];

export interface PersistedNav {
  tab: TabKey;
  stack: StackEntry[];
}

/** Read the persisted nav-state — returns null on SSR, unavailable storage, or a
 *  malformed payload (so a corrupt value can never wedge the app on boot). */
export function loadNavState(): PersistedNav | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(NAV_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedNav>;
    if (!parsed || !PERSISTED_TABS.includes(parsed.tab as TabKey) || !Array.isArray(parsed.stack)) {
      return null;
    }
    // Shallow-validate each entry; drop anything that isn't a {name, props}.
    const stack = parsed.stack.filter(
      (e): e is StackEntry =>
        !!e && typeof (e as StackEntry).name === 'string' && typeof (e as StackEntry).props === 'object'
    );
    return { tab: parsed.tab as TabKey, stack };
  } catch {
    return null;
  }
}

/** Persist the nav-state; silently no-ops when storage is unavailable. */
export function saveNavState(state: PersistedNav): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(NAV_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota / native webview without storage — ignore */
  }
}

/** Drop the persisted nav-state so the next load starts fresh on the default tab.
 *  Used before a venue-create full-reload: without this, the reload would restore
 *  the venuecreate screen from sessionStorage instead of landing the new owner on
 *  the new venue's Start tab. */
export function clearNavState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(NAV_STORAGE_KEY);
  } catch {
    /* unavailable storage — nothing to clear */
  }
}
