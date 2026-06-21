'use client';

/**
 * Connectivity, realtime and delta-sync for the door (spec §4 points 2–4).
 *
 *  - tracks `online` (navigator + online/offline events) and `realtimeConnected`
 *    (channel state);
 *  - runs `onSync` (drain outbox + refetch snapshot) on mount, on reconnect, on
 *    visibilitychange/focus, and on a 60s safety interval;
 *  - subscribes to `check_ins` INSERTs (all — they carry no event_id, so the
 *    provider filters by snapshot membership) and `guests` changes for this
 *    event, forwarding rows to the provider for cache patching (~1s, point 9);
 *  - derives the status-bar state from `status.ts`.
 *
 * Callbacks are kept in refs so connectivity/timer effects never re-subscribe.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { getDoorClient } from '../offline/device';
import { shouldRefetchOnStatus, type ChannelStatus } from './reconnect';
import { deriveSyncStatus, syncAgeLabel, type SyncStatus } from './status';

type CheckInRow = Database['public']['Tables']['check_ins']['Row'];
type GuestRow = Database['public']['Tables']['guests']['Row'];

const TICK_MS = 15_000; // refresh the "X min geleden" label + status
const SAFETY_SYNC_MS = 60_000; // background delta-sync floor

export interface DoorSyncHandlers {
  eventId: string;
  onSync: () => Promise<void>;
  onRealtimeCheckIn: (row: CheckInRow) => void;
  onRealtimeGuest: (row: GuestRow) => void;
}

export interface DoorSyncState {
  status: SyncStatus;
  ageLabel: string;
  online: boolean;
  realtimeConnected: boolean;
  syncing: boolean;
  lastSyncAt: number | null;
  forceSync: () => void;
}

export function useDoorSync({ eventId, onSync, onRealtimeCheckIn, onRealtimeGuest }: DoorSyncHandlers): DoorSyncState {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const onSyncRef = useRef(onSync);
  onSyncRef.current = onSync;
  const onCheckInRef = useRef(onRealtimeCheckIn);
  onCheckInRef.current = onRealtimeCheckIn;
  const onGuestRef = useRef(onRealtimeGuest);
  onGuestRef.current = onRealtimeGuest;
  const inFlight = useRef(false);

  const runSync = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      await onSyncRef.current();
      setLastSyncAt(Date.now());
    } catch {
      // Keep the previous lastSyncAt; the status bar will degrade to stale/warn.
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, []);

  // Online/offline.
  useEffect(() => {
    const goOnline = (): void => {
      setOnline(true);
      void runSync();
    };
    const goOffline = (): void => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [runSync]);

  // Delta-sync on every screen activation (spec §4 point 2).
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void runSync();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [runSync]);

  // Initial sync + safety floor.
  useEffect(() => {
    void runSync();
    const id = window.setInterval(() => void runSync(), SAFETY_SYNC_MS);
    return () => window.clearInterval(id);
  }, [runSync]);

  // Keep the label/status fresh without a network call.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  // Realtime channel for this event.
  useEffect(() => {
    const client = getDoorClient();
    let cancelled = false;
    let channel: RealtimeChannel | null = null;
    // Previous channel status, so a resubscribe after a drop can self-heal the
    // burst it missed (#0b). Local to this effect → reset per eventId.
    let prevStatus: ChannelStatus | null = null;

    // Authenticate realtime with the user's JWT BEFORE subscribing, so the
    // postgres_changes bindings are evaluated under the user's RLS (a doorhost
    // may SELECT the venue's check_ins). Subscribing as anon would silently
    // deliver nothing. Cookie-hydrated sessions can lag, hence the await.
    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) client.realtime.setAuth(token);

      channel = client
        .channel(`door:${eventId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins' }, (payload) => {
          onCheckInRef.current(payload.new as CheckInRow);
          setNow(Date.now());
        })
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${eventId}` },
          (payload) => {
            if (payload.new && Object.keys(payload.new).length > 0) onGuestRef.current(payload.new as GuestRow);
          },
        )
        .subscribe((st) => {
          if (cancelled) return;
          // Self-heal: if we just resubscribed after a drop, drain the outbox +
          // refetch the snapshot so any check-ins missed while down reappear (#0b).
          if (shouldRefetchOnStatus(prevStatus, st)) void onSyncRef.current();
          prevStatus = st;
          setRealtimeConnected(st === 'SUBSCRIBED');
        });
    });

    return () => {
      cancelled = true;
      setRealtimeConnected(false);
      if (channel) void client.removeChannel(channel);
    };
  }, [eventId]);

  return {
    status: deriveSyncStatus({ online, realtimeConnected, lastSyncAt, now }),
    ageLabel: syncAgeLabel(lastSyncAt, now),
    online,
    realtimeConnected,
    syncing,
    lastSyncAt,
    forceSync: runSync,
  };
}
