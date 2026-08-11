'use client';

// Client context for the po live-data layer (STAP 3.2): one QueryClient for the
// /app surface plus the caller's identity (user + active venue), resolved
// server-side in app/page.tsx and passed in. NOT persisted — the door keeps its
// own offline/outbox QueryClient (DoorProvider) and we never duplicate it (#25).
import { createContext, type JSX, useContext, useEffect, useState, type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setUser as sentrySetUser, setTag as sentrySetTag } from '@/lib/observability/sentry-client';
import { captureUnexpectedError } from '@/lib/observability/capture';
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
    // Report unexpected query/mutation failures to Sentry (the "unexpected only"
    // gate lives in captureUnexpectedError — offline/abort are filtered out).
    // retry: 1 → onError fires once after the final retry, so no duplicate events;
    // query errors are not rethrown to render, so no double-report via boundaries.
    queryCache: new QueryCache({
      onError: (error, query) =>
        captureUnexpectedError(error, {
          source: 'query',
          key: String(query.queryKey[0] ?? ''),
        }),
    }),
    mutationCache: new MutationCache({
      onError: (error) => captureUnexpectedError(error, { source: 'mutation' }),
    }),
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

  // Diagnostic context for every Sentry event on the /app surface. UUIDs + roles
  // are NOT guest PII (the guest is never the signed-in user); email/ip are never
  // set (AVG). Cleared on unmount so a logout doesn't leak identity into the next.
  useEffect(() => {
    sentrySetUser({ id: identity.userId });
    sentrySetTag('venue.id', identity.venueId ?? 'none');
    sentrySetTag('roles', identity.roles.join(','));
    return () => sentrySetUser(null);
  }, [identity.userId, identity.venueId, identity.roles]);

  return (
    <QueryClientProvider client={client}>
      <PoIdentityContext.Provider value={identity}>{children}</PoIdentityContext.Provider>
    </QueryClientProvider>
  );
}
