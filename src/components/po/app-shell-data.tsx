'use client';

/**
 * Carries the /app shell's server-resolved display data (venue list, stats
 * access, live names) from `layout.tsx` down to `PlusOneApp` (G1). Split out
 * from `PoLiveProvider` (identity + QueryClient) because this is pure display
 * data with no identity/auth meaning of its own — keeping it separate avoids
 * overloading `PoIdentity` with fields most `usePoIdentity()` callers don't need.
 */
import { createContext, type JSX, useContext, type ReactNode } from 'react';
import type { PoVenueMembership } from './context';

export interface AppShellData {
  statsAccess?: { venues: { venueId: string; venueName: string }[] };
  myVenues: PoVenueMembership[];
  activeVenueId: string | null;
  serverHint: boolean;
  /** Live active-venue name from the session (shell display); generic fallback otherwise. */
  liveVenueName?: string;
  liveUserName?: string;
  liveUserSub?: string;
  /**
   * The store-review demo account (86ey6bfug), resolved server-side in the
   * layout from the session's id + e-mail (`isDemoReviewUser`). UX only: it
   * turns refused entry points (new venue, invites, e-mail change) into an
   * upfront note instead of a form that fails on submit. The server actions
   * and DB guards stay the security boundary.
   */
  demoAccount?: boolean;
}

const AppShellDataContext = createContext<AppShellData | null>(null);

export function AppShellDataProvider({ value, children }: { value: AppShellData; children: ReactNode }): JSX.Element {
  return <AppShellDataContext.Provider value={value}>{children}</AppShellDataContext.Provider>;
}

/**
 * True for the store-review demo account. Tolerant of a missing provider
 * (screens rendered on their own, e.g. in tests) — that reads as "not demo",
 * which only ever shows the normal form; the server still refuses.
 */
export function useIsDemoAccount(): boolean {
  return useContext(AppShellDataContext)?.demoAccount === true;
}

export function useAppShellData(): AppShellData {
  const v = useContext(AppShellDataContext);
  if (!v) throw new Error('useAppShellData must be used within AppShellDataProvider');
  return v;
}
