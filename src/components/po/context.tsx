'use client';

/**
 * Navigation + shared app state for the po surface. The nav stack used to be
 * in-memory (a `StackEntry[]` + sessionStorage restore hack); every screen now
 * has a real URL (G1, `./routes.ts`), so the URL itself is the persisted state
 * and this file only holds the `Nav` interface + shared app state. The door
 * check-in state used to live here too; it now comes from the real DoorProvider
 * (TanStack Query + offline outbox + realtime) under the Deur/Taken tabs, so it
 * is no longer duplicated here (#25).
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
  | 'rollen'
  | 'import'
  | 'quickadd'
  | 'bulk'
  | 'aanvragen'
  | 'eventedit'
  | 'tiers'
  | 'crew'
  | 'gebruikers'
  | 'pastevent'
  | 'venueswitch'
  | 'venuesettings'
  | 'venuecreate'
  | 'profile'
  | 'billing'
  | 'allowance'
  | 'stats'
  | 'audit'
  | 'adminsessions'
  | 'templates'
  | 'templateedit'
  | 'links'
  | 'influencers'
  | 'promo';

export interface ScreenProps {
  id?: string;
  /** Event scope for the guest detail (props.id there is the guest id). */
  eventId?: string;
  isNew?: boolean;
  /** Approvals (aanvragen) deep-link: which queue to open first. */
  tab?: 'landing' | 'quota';
}

export interface Nav {
  push: (name: ScreenName, props?: ScreenProps) => void;
  /** Swap the current screen without adding a back step. For after-create flows:
   *  "New event" → replace with the created event's settings, so back returns to
   *  where the flow started instead of the stale create form. */
  replace: (name: ScreenName, props?: ScreenProps) => void;
  back: () => void;
  setTab: (t: TabKey) => void;
  /** Open the Deur tab for a SPECIFIC event (S1.3) — "Check-in" from an event card
   *  must land on that event's door, not the venue-wide auto-pick. */
  openDoor: (eventId: string) => void;
  /** True when there is in-app navigation history to go back to. Screens can use
   *  this to show or hide a back button without knowing the full nav state. */
  canGoBack: boolean;
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
  /** Current viewport (S0 breakpoint, ≥1024px = desktop). Lets a screen hide
   *  chrome that's redundant with the desktop sidebar (M12/M5: one venue-switch
   *  entry — the sidebar's header-picker — instead of a second one in More). */
  isMobile: boolean;
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
