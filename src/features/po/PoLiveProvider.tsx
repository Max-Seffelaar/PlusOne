'use client';

// Client context for the po live-data layer (STAP 3.2): one QueryClient for the
// /app surface plus the caller's identity (user + active venue), resolved
// server-side in app/page.tsx and passed in. NOT persisted — the door keeps its
// own offline/outbox QueryClient (DoorProvider) and we never duplicate it (#25).
import { createContext, useContext, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { VenueRole } from '@/features/auth/roles';

export interface PoIdentity {
  userId: string;
  venueId: string | null;
  venueName: string | null;
  roles: VenueRole[];
}

const PoIdentityContext = createContext<PoIdentity | null>(null);

export function usePoIdentity(): PoIdentity {
  const value = useContext(PoIdentityContext);
  if (!value) throw new Error('usePoIdentity must be used within PoLiveProvider');
  return value;
}

function createPoQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 30,
        gcTime: 1000 * 60 * 5,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

export function PoLiveProvider({
  identity,
  children,
}: {
  identity: PoIdentity;
  children: ReactNode;
}): JSX.Element {
  // One client per mount (App Router pattern: never share across requests).
  const [client] = useState(createPoQueryClient);

  return (
    <QueryClientProvider client={client}>
      <PoIdentityContext.Provider value={identity}>{children}</PoIdentityContext.Provider>
    </QueryClientProvider>
  );
}
