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
  /** Raise an already-checked-in guest's arrivals by `addArrived` ("nog inchecken"). */
  topUp: (guestId: string, addArrived: number) => void;
  /** Soft-void a mistaken check-in — the guest returns to "onderweg" (#3). */
  voidCheckIn: (guestId: string) => void;
  /** Re-checkin a previously voided guest (clears the void, re-sets arrivals). */
  reviveCheckIn: (guestId: string, totalPeople: number) => void;
  refuse: (guestId: string, reason: string) => void;
  /** Re-admit a guest refused by mistake — status back to approved (#10). */
  undoRefusal: (guestId: string) => void;
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
      .auth.getUser()
      .then(({ data }) => setMeId(data.user?.id ?? null));
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
      const {
        data: { user },
      } = await client.auth.getUser();
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
          voided_at: null,
          voided_by: null,
        };
        return { ...s, checkIns: [...s.checkIns, row] };
      });
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      showToast(`${g?.name ?? 'Gast'}${plusArrived > 0 ? ` +${plusArrived}` : ''} · binnen ✓`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  // "Nog inchecken": raise plus_ones_arrived for a guest already inside. We read
  // the current arrivals + allotment from the live view and send the NEW absolute
  // target (capped client-side; the trigger caps + keeps it monotonic server-side).
  const topUp = useCallback(
    (guestId: string, addArrived: number) => {
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      if (!g || !g.inside) return;
      const current = g.arrived ?? 0;
      const target = Math.min(g.plus, current + Math.max(0, addArrived));
      if (target <= current) return;
      const ts = new Date().toISOString();
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'check_in_topup',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { guestId, plusOnesArrived: target, clientTimestamp: ts },
      });
      patchSnapshot((s) => ({
        ...s,
        checkIns: s.checkIns.map((c) =>
          c.guest_id === guestId ? { ...c, plus_ones_arrived: Math.max(c.plus_ones_arrived, target) } : c,
        ),
      }));
      showToast(`${g.name} · nu ${1 + target} binnen`);
      maybeFlush();
    },
    [eventId, patchSnapshot, showToast, maybeFlush],
  );

  // "Check-in terugdraaien": soft-void a mistaken check-in (#3 — never deleted).
  // The guest returns to "onderweg"; the row is flagged voided_at and excluded
  // from "aanwezig" everywhere. Any door-scoped colleague may do this (RLS).
  const voidCheckIn = useCallback(
    (guestId: string) => {
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      if (!g || !g.inside) return;
      const ts = new Date().toISOString();
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'check_in_void',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { guestId, clientTimestamp: ts },
      });
      patchSnapshot((s) => ({
        ...s,
        checkIns: s.checkIns.map((c) =>
          c.guest_id === guestId ? { ...c, voided_at: ts, voided_by: meId ?? '' } : c,
        ),
      }));
      showToast(`${g.name} · check-in teruggedraaid`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  // "Opnieuw inchecken": revive a voided check-in (clears voided_at, re-sets
  // arrivals fresh — the cap trigger is revive-aware so it does not hold the old
  // count). Reuses the one row per guest (#11), so no new INSERT/duplicate.
  const reviveCheckIn = useCallback(
    (guestId: string, totalPeople: number) => {
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      if (!g || !g.voided) return;
      const plusArrived = Math.min(g.plus, Math.max(0, totalPeople - 1));
      const ts = new Date().toISOString();
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'check_in_revive',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { guestId, plusOnesArrived: plusArrived, clientTimestamp: ts },
      });
      patchSnapshot((s) => ({
        ...s,
        checkIns: s.checkIns.map((c) =>
          c.guest_id === guestId
            ? { ...c, voided_at: null, voided_by: null, checked_by: meId ?? '', checked_at: ts, plus_ones_arrived: plusArrived }
            : c,
        ),
      }));
      showToast(`${g.name}${plusArrived > 0 ? ` +${plusArrived}` : ''} · weer binnen ✓`);
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
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      patchSnapshot((s) => ({
        ...s,
        // Mirror the server trigger optimistically: the guest moves to 'refused'
        // (→ the "Geweigerd" lijst) and the refusal row carries the reason.
        guests: s.guests.map((x) => (x.id === guestId ? { ...x, status: 'refused' as const } : x)),
        refusals: [
          ...s.refusals,
          { id, guest_id: guestId, refused_by: meId ?? '', reason, refused_at: ts, client_timestamp: ts, device_id: getDeviceId(), created_at: ts, anonymized_at: null },
        ],
      }));
      showToast(`${g?.name ?? 'Gast'} · geweigerd`);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  // "Weigering ongedaan maken": re-admit a mistakenly refused guest. Status goes
  // back to 'approved' (→ onderweg); the refusal row stays as history (#10/#15).
  const undoRefusal = useCallback(
    (guestId: string) => {
      const ts = new Date().toISOString();
      const g = viewRef.current?.refused.find((x) => x.id === guestId);
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'undo_refusal',
        status: 'pending',
        attempts: 0,
        createdAt: ts,
        payload: { guestId, clientTimestamp: ts },
      });
      patchSnapshot((s) => ({
        ...s,
        guests: s.guests.map((x) => (x.id === guestId ? { ...x, status: 'approved' as const } : x)),
      }));
      showToast(`${g?.name ?? 'Gast'} · weer op de lijst`);
      maybeFlush();
    },
    [eventId, patchSnapshot, showToast, maybeFlush],
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
          contact_id: null,
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
      // Keep refused too — the door shows a "Geweigerd" lijst; only pending/
      // denied/removed drop out of the snapshot.
      const keep = row.status === 'approved' || row.status === 'checked_in' || row.status === 'refused';
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
      topUp,
      voidCheckIn,
      reviveCheckIn,
      refuse,
      undoRefusal,
      addOnSpot,
      ackNote,
    }),
    [eventId, view, tasks, quotaQuery.data, defaultTierId, sync, toast, pendingCount, outboxByGuest, guestById, checkIn, topUp, voidCheckIn, reviveCheckIn, refuse, undoRefusal, addOnSpot, ackNote],
  );

  return <DoorContext.Provider value={value}>{children}</DoorContext.Provider>;
}
