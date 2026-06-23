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
  | 'adminsessions';

export interface ScreenProps {
  id?: string;
  /** Event scope for the guest detail (props.id there is the guest id). */
  eventId?: string;
  isNew?: boolean;
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
