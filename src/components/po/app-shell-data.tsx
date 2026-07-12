'use client';

/**
 * Carries the /app shell's server-resolved display data (venue list, stats
 * access, live names) from `layout.tsx` down to `PlusOneApp` (G1). Split out
 * from `PoLiveProvider` (identity + QueryClient) because this is pure display
 * data with no identity/auth meaning of its own — keeping it separate avoids
 * overloading `PoIdentity` with fields most `usePoIdentity()` callers don't need.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PoVenueMembership } from './context';

export interface AppShellData {
  statsAccess?: { venues: { venueId: string; venueName: string }[] };
  myVenues: PoVenueMembership[];
  activeVenueId: string | null;
  serverHint: boolean;
  liveVenueName?: string;
  liveUserName?: string;
  liveUserSub?: string;
}

const AppShellDataContext = createContext<AppShellData | null>(null);

export function AppShellDataProvider({ value, children }: { value: AppShellData; children: ReactNode }): JSX.Element {
  return <AppShellDataContext.Provider value={value}>{children}</AppShellDataContext.Provider>;
}

export function useAppShellData(): AppShellData {
  const v = useContext(AppShellDataContext);
  if (!v) throw new Error('useAppShellData must be used within AppShellDataProvider');
  return v;
}
