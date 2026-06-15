'use client';

/**
 * TanStack Query provider with IndexedDB persistence for the door route. The
 * snapshot cache is restored from IndexedDB on boot so the door opens instantly
 * and works offline after a reload (spec §4, decision #25).
 */
import { useState, type ReactNode } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createDoorQueryClient } from './offline/query-client';
import { createIdbPersister } from './offline/persister';

const WEEK_MS = 1000 * 60 * 60 * 24 * 7;

export function DoorQueryProvider({ children }: { children: ReactNode }): JSX.Element {
  const [client] = useState(() => createDoorQueryClient());
  const [persister] = useState(() => createIdbPersister());

  return (
    <PersistQueryClientProvider client={client} persistOptions={{ persister, maxAge: WEEK_MS }}>
      {children}
    </PersistQueryClientProvider>
  );
}
