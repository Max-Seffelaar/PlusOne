'use client';

/**
 * Door orchestration: ties the cached snapshot (TanStack Query + IndexedDB) to
 * the offline outbox, realtime, and the sync-status bar, and exposes a small API
 * the screens consume. Every mutation is optimistic (patch the cached snapshot)
 * + queued (outbox) + flushed when online; realtime patches the same cache so
 * colleagues' check-ins appear within ~1s (spec §4, decisions #11/#25/#39).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { getDeviceId, getDoorClient } from './offline/device';
import { drainOutbox } from './outbox/replay';
import { supabaseGateway } from './outbox/gateway';
import { outbox } from './outbox/store';
import type { OutboxEntry } from './outbox/types';
import { useDoorSync, type DoorSyncState } from './sync/useDoorSync';
import {
  doorSnapshotKey,
  fetchDoorSnapshot,
  fetchEventQuota,
  type CheckInRow,
  type DoorSnapshot,
  type GuestRow,
  type QuotaStatus,
} from './queries';
import { buildDoorView, buildTasks, type DoorGuest, type DoorTask, type DoorView } from './model';

const QUOTA_KEY = (eventId: string) => ['door-quota', eventId] as const;
const TOAST_MS = 2600;

export interface AddOnSpotInput {
  name: string;
  plusOnes: number;
  tierId: string;
}

interface DoorContextValue {
  eventId: string;
  view: DoorView | null;
  tasks: DoorTask[];
  quota: QuotaStatus | null;
  defaultTierId: string | null;
  sync: DoorSyncState;
  toast: string | null;
  /** Entries for this event still awaiting the network (sync-bar queue badge). */
  pendingCount: number;
  /** guest_id → its outbox entries (for the "duplicaat" marker). */
  outboxByGuest: Map<string, OutboxEntry[]>;
  guestById: (id: string) => DoorGuest | undefined;
  checkIn: (guestId: string, totalPeople: number) => void;
  refuse: (guestId: string, reason: string) => void;
  addOnSpot: (input: AddOnSpotInput) => void;
  ackNote: (guestId: string, ack: boolean) => void;
}

const DoorContext = createContext<DoorContextValue | null>(null);

export function useDoor(): DoorContextValue {
  const v = useContext(DoorContext);
  if (!v) throw new Error('useDoor must be used within DoorProvider');
  return v;
}

export function DoorProvider({
  eventId,
  initialSnapshot,
  children,
}: {
  eventId: string;
  initialSnapshot?: DoorSnapshot;
  children: ReactNode;
}): JSX.Element {
  const queryClient = useQueryClient();
  const [meId, setMeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outbox: load once, subscribe for re-render.
  useEffect(() => {
    void outbox.init();
  }, []);
  const outboxEntries = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getServerSnapshot);

  useEffect(() => {
    getDoorClient()
      .auth.getSession()
      .then(({ data }) => setMeId(data.session?.user?.id ?? null));
  }, []);

  const snapshotQuery = useQuery({
    queryKey: doorSnapshotKey(eventId),
    queryFn: () => fetchDoorSnapshot(getDoorClient(), eventId),
    initialData: initialSnapshot,
  });
  const quotaQuery = useQuery({
    queryKey: QUOTA_KEY(eventId),
    queryFn: () => fetchEventQuota(getDoorClient(), eventId),
    initialData: undefined as QuotaStatus | null | undefined,
  });

  const snapshot = snapshotQuery.data;
  const view = useMemo(() => (snapshot ? buildDoorView(snapshot) : null), [snapshot]);
  const tasks = useMemo(() => (view ? buildTasks(view) : []), [view]);
  const defaultTierId = useMemo(
    () => (snapshot ? resolveDefaultTierId(snapshot.tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }))) : null),
    [snapshot],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  const outboxByGuest = useMemo(() => {
    const map = new Map<string, OutboxEntry[]>();
    for (const e of outboxEntries) {
      const guestId = e.kind === 'add_guest' ? e.payload.id : 'guestId' in e.payload ? e.payload.guestId : null;
      if (!guestId) continue;
      const list = map.get(guestId) ?? [];
      list.push(e);
      map.set(guestId, list);
    }
    return map;
  }, [outboxEntries]);

  const pendingCount = useMemo(
    () => outboxEntries.filter((e) => e.eventId === eventId && (e.status === 'pending' || e.status === 'syncing')).length,
    [outboxEntries, eventId],
  );

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const patchSnapshot = useCallback(
    (updater: (s: DoorSnapshot) => DoorSnapshot) => {
      queryClient.setQueryData<DoorSnapshot>(doorSnapshotKey(eventId), (prev) => (prev ? updater(prev) : prev));
    },
    [queryClient, eventId],
  );

  // ── Sync: drain the outbox, then refetch the snapshot + quota (when online).
  const flushPromise = useRef<Promise<void> | null>(null);
  const flush = useCallback((): Promise<void> => {
    if (flushPromise.current) return flushPromise.current;
    const run = (async () => {
      const client = getDoorClient();
      // Local session read (no network) — see queries.ts / door-live.tsx: only the
      // uid is needed for outbox attribution; RLS authorises the actual write.
      const {
        data: { session },
      } = await client.auth.getSession();
      const user = session?.user;
      if (user) {
        const summary = await drainOutbox({
          list: () => [...outbox.getSnapshot()],
          update: (id, patch) => outbox.update(id, patch),
          gateway: supabaseGateway(client),
          uid: user.id,
          deviceId: getDeviceId(),
        });
        if (summary.duplicates > 0) showToast('Was al ingecheckt op een ander apparaat');
        if (summary.errors > 0) {
          const failed = outbox.getSnapshot().find((e) => e.status === 'error' && e.message);
          if (failed?.message) showToast(failed.message);
        }
        outbox.clearSynced();
      }
      if (typeof navigator === 'undefined' || navigator.onLine) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: doorSnapshotKey(eventId) }),
          queryClient.invalidateQueries({ queryKey: QUOTA_KEY(eventId) }),
        ]);
      }
    })().finally(() => {
      flushPromise.current = null;
    });
    flushPromise.current = run;
    return run;
  }, [eventId, queryClient, showToast]);

  const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;
  const maybeFlush = useCallback(() => {
    if (isOnline()) void flush();
  }, [flush]);

  // ── Mutations (optimistic patch + outbox enqueue + flush).
  const checkIn = useCallback(
    (guestId: string, totalPeople: number) => {
      const ciId = uuidv7();
      const ts = new Date().toISOString();
      const plusArrived = Math.max(0, totalPeople - 1);
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'check_in',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { id: ciId, guestId, plusOnesArrived: plusArrived, clientTimestamp: ts },
      });
      patchSnapshot((s) => {
        if (s.checkIns.some((c) => c.guest_id === guestId)) return s;
        const row: CheckInRow = {
          id: ciId,
          guest_id: guestId,
          checked_by: meId ?? '',
          checked_at: ts,
          client_timestamp: ts,
          device_id: getDeviceId(),
          plus_ones_arrived: plusArrived,
          offline_synced: false,
          created_at: ts,
        };
        return { ...s, checkIns: [...s.checkIns, row] };
      });
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      showToast(`${g?.name ?? 'Gast'}${plusArrived > 0 ? ` +${plusArrived}` : ''} · binnen ✓`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  const refuse = useCallback(
    (guestId: string, reason: string) => {
      const id = uuidv7();
      const ts = new Date().toISOString();
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'refusal',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { id, guestId, reason, clientTimestamp: ts },
      });
      patchSnapshot((s) => ({
        ...s,
        refusals: [
          ...s.refusals,
          { id, guest_id: guestId, refused_by: meId ?? '', reason, refused_at: ts, client_timestamp: ts, device_id: getDeviceId(), created_at: ts },
        ],
      }));
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      showToast(`${g?.name ?? 'Gast'} · geweigerd`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  const addOnSpot = useCallback(
    ({ name, plusOnes, tierId }: AddOnSpotInput) => {
      const id = uuidv7();
      const ts = new Date().toISOString();
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'add_guest',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { id, tierId, fullName: name, plusOnes },
      });
      patchSnapshot((s) => {
        const row: GuestRow = {
          id,
          event_id: eventId,
          tier_id: tierId,
          full_name: name,
          email: null,
          phone: null,
          plus_ones: plusOnes,
          note: null,
          note_priority: 'none',
          note_acknowledged_by: null,
          note_acknowledged_at: null,
          added_by: meId ?? '',
          source: 'door',
          status: 'approved',
          anonymized_at: null,
          removed_at: null,
          created_at: ts,
          updated_at: ts,
        };
        return { ...s, guests: [...s.guests, row] };
      });
      showToast(`${name}${plusOnes > 0 ? ` +${plusOnes}` : ''} · op de lijst`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  const ackNote = useCallback(
    (guestId: string, ack: boolean) => {
      const ts = ack ? new Date().toISOString() : null;
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'ack_note',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        payload: { guestId, ack },
      });
      patchSnapshot((s) => ({
        ...s,
        guests: s.guests.map((g) =>
          g.id === guestId ? { ...g, note_acknowledged_at: ts, note_acknowledged_by: ack ? meId ?? '' : null } : g,
        ),
      }));
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, maybeFlush],
  );

  // ── Realtime patches (deduped) → instant colleague check-ins (point 9).
  const onRealtimeCheckIn = useCallback(
    (row: CheckInRow) => {
      patchSnapshot((s) => {
        if (!s.guests.some((g) => g.id === row.guest_id)) return s; // another event
        if (s.checkIns.some((c) => c.id === row.id || c.guest_id === row.guest_id)) return s;
        return { ...s, checkIns: [...s.checkIns, row] };
      });
    },
    [patchSnapshot],
  );
  const onRealtimeGuest = useCallback(
    (row: GuestRow) => {
      if (row.event_id !== eventId) return;
      const keep = row.status === 'approved' || row.status === 'checked_in';
      patchSnapshot((s) => {
        const without = s.guests.filter((g) => g.id !== row.id);
        return { ...s, guests: keep ? [...without, row] : without };
      });
    },
    [eventId, patchSnapshot],
  );

  const sync = useDoorSync({ eventId, onSync: flush, onRealtimeCheckIn, onRealtimeGuest });

  const guestById = useCallback((id: string) => viewRef.current?.guests.find((g) => g.id === id), []);

  const value = useMemo<DoorContextValue>(
    () => ({
      eventId,
      view,
      tasks,
      quota: quotaQuery.data ?? null,
      defaultTierId,
      sync,
      toast,
      pendingCount,
      outboxByGuest,
      guestById,
      checkIn,
      refuse,
      addOnSpot,
      ackNote,
    }),
    [eventId, view, tasks, quotaQuery.data, defaultTierId, sync, toast, pendingCount, outboxByGuest, guestById, checkIn, refuse, addOnSpot, ackNote],
  );

  return <DoorContext.Provider value={value}>{children}</DoorContext.Provider>;
}
