'use client';

/**
 * Live-data context for the prototype. Wraps the `PlusOneApp` client tree with a
 * TanStack Query client and a session loaded from Supabase (via the browser
 * client, which reads the cookie session set at login). Screens pull their data
 * through the hooks here instead of importing the mock arrays — same shapes, real
 * rows. Mirrors the door feature's provider pattern.
 */
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { PoEvent, Venue } from '@/lib/po/types';
import { fetchPoEvents, fetchPoSession, type PoSession } from './live-queries';

interface SessionCtx {
  session: PoSession | null;
  isLoading: boolean;
  currentVenue: Venue | null;
  setCurrentVenueId: (id: string) => void;
}

const Ctx = createContext<SessionCtx | null>(null);

function useBrowserClient() {
  // One browser client per provider instance.
  const [client] = useState(() => createClient());
  return client;
}

function SessionGate({ children }: { children: ReactNode }): JSX.Element {
  const client = useBrowserClient();
  const [overrideVenueId, setOverrideVenueId] = useState<string | null>(null);

  const { data: session = null, isLoading } = useQuery({
    queryKey: ['po', 'session'],
    queryFn: () => fetchPoSession(client),
    staleTime: 60_000,
  });

  const currentVenueId = overrideVenueId ?? session?.currentVenueId ?? null;
  const currentVenue =
    session?.venues.find((v) => v.id === currentVenueId) ?? session?.venues[0] ?? null;

  const value = useMemo<SessionCtx>(
    () => ({ session, isLoading, currentVenue, setCurrentVenueId: setOverrideVenueId }),
    [session, isLoading, currentVenue],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function PoLiveProvider({ children }: { children: ReactNode }): JSX.Element {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <SessionGate>{children}</SessionGate>
    </QueryClientProvider>
  );
}

export function useSession(): SessionCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be used within PoLiveProvider');
  return v;
}

/** Events for the current venue, mapped to PoEvent[]. */
export function usePoEvents(): { events: PoEvent[]; isLoading: boolean } {
  const client = useBrowserClient();
  const { currentVenue } = useSession();
  const venueId = currentVenue?.id ?? null;
  const { data: events = [], isLoading } = useQuery({
    queryKey: ['po', 'events', venueId],
    queryFn: () => (venueId ? fetchPoEvents(client, venueId) : Promise.resolve([])),
    enabled: Boolean(venueId),
  });
  return { events, isLoading };
}
