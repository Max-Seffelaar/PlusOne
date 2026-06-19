'use client';

/**
 * Navigation + shared door state for the prototype. Mirrors the in-memory nav
 * stack and check-in state from `po-app.jsx`, exposed through context so screens
 * don't prop-drill. When wired to Supabase later, `nav` becomes the App Router
 * and this door state moves to TanStack Query + the offline outbox.
 */
import { createContext, useContext } from 'react';
import type { TabKey } from './shell';
import type { Venue } from '@/lib/po/types';

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
  | 'stats';

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
}

export type AuthView = 'welcome' | 'login' | 'otp' | 'mfa' | 'invite';

export interface AuthNav {
  go: (v: AuthView, props?: { email?: string }) => void;
  start: () => void;
}

export interface CheckInEntry {
  at: string;
  by: string;
}

export interface PoApp {
  inside: Set<string>;
  log: Record<string, CheckInEntry>;
  checkIn: (id: string, total: number) => void;
  uncheck: (id: string) => void;
  taskDone: (id: string) => boolean;
  ackTask: (id: string, val: boolean) => void;
  venue: Venue;
  switchVenue: (v: Venue) => void;
  statsVenues: { venueId: string; venueName: string }[];
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
