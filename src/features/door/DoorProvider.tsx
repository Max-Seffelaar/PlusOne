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

/** kind + payload pairs for enqueueDoorWrite — envelope fields are filled centrally. */
type OutboxWrite = {
  [K in OutboxEntry['kind']]: { kind: K; payload: Extract<OutboxEntry, { kind: K }>['payload'] };
}[OutboxEntry['kind']];

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
  /** Effective "uitchecken toestaan" for this event (#3 / S1.1). When false the
   *  screens hide the "Check-in terugdraaien" affordance; RLS rejects it too. */
  allowUncheck: boolean;
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

  // ── D3: build view + guest lookup map in one pass (O(1) guestById vs O(n) find).
  // Map includes both active and refused guests so all mutations can resolve names.
  const { view, guestMap } = useMemo(() => {
    if (!snapshot) return { view: null, guestMap: new Map<string, DoorGuest>() };
    const v = buildDoorView(snapshot);
    return {
      view: v,
      guestMap: new Map<string, DoorGuest>([
        ...v.guests.map((g): [string, DoorGuest] => [g.id, g]),
        ...v.refused.map((g): [string, DoorGuest] => [g.id, g]),
      ]),
    };
  }, [snapshot]);

  const tasks = useMemo(() => (view ? buildTasks(view) : []), [view]);
  const defaultTierId = useMemo(
    () => (snapshot ? resolveDefaultTierId(snapshot.tiers.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases }))) : null),
    [snapshot],
  );

  // Stable refs so mutation callbacks don't need view/guestMap in their dep arrays.
  const viewRef = useRef(view);
  viewRef.current = view;
  const guestMapRef = useRef(guestMap);
  guestMapRef.current = guestMap;

  // ── D2: Sets for O(1) realtime dedup (replaces O(n) .some() on the hot path).
  // Eagerly updated in onRealtimeCheckIn; rebuilt synchronously during render when
  // a new snapshot lands (not in an effect — an effect leaves a window where a
  // realtime event arrives before the Sets exist and slips past the dedup guard).
  const guestIdSetRef = useRef<Set<string>>(new Set());
  const checkInIdSetRef = useRef<Set<string>>(new Set());
  const checkInGuestIdSetRef = useRef<Set<string>>(new Set());
  const dedupSnapshotRef = useRef<typeof snapshot | undefined>(undefined);

  if (snapshot && dedupSnapshotRef.current !== snapshot) {
    dedupSnapshotRef.current = snapshot;
    guestIdSetRef.current = new Set(snapshot.guests.map((g) => g.id));
    checkInIdSetRef.current = new Set(snapshot.checkIns.map((c) => c.id));
    checkInGuestIdSetRef.current = new Set(snapshot.checkIns.map((c) => c.guest_id));
  }

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
        if (summary.duplicates > 0) showToast('Was already checked in on another device');
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

  // ── 2a: centralised outbox envelope — clientId / status / attempts / createdAt
  // are always the same boilerplate; kind + payload + patchFn vary per mutation.
  const enqueueDoorWrite = useCallback(
    (write: OutboxWrite, patchFn: (s: DoorSnapshot) => DoorSnapshot, toastMsg?: string) => {
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        ...write,
      } as OutboxEntry);
      patchSnapshot(patchFn);
      if (toastMsg) showToast(toastMsg);
      maybeFlush();
    },
    [eventId, patchSnapshot, showToast, maybeFlush],
  );

  // ── Mutations (thin wrappers over enqueueDoorWrite).

  const checkIn = useCallback(
    (guestId: string, totalPeople: number) => {
      const ciId = uuidv7();
      const ts = new Date().toISOString();
      const plusArrived = Math.max(0, totalPeople - 1);
      const g = guestMapRef.current.get(guestId);
      enqueueDoorWrite(
        { kind: 'check_in', payload: { id: ciId, guestId, plusOnesArrived: plusArrived, clientTimestamp: ts } },
        (s) => {
          if (s.checkIns.some((c) => c.guest_id === guestId)) return s;
          const row: CheckInRow = {
            id: ciId,
            guest_id: guestId,
            event_id: eventId,
            venue_id: s.event.venueId,
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
        },
        `${g?.name ?? 'Guest'}${plusArrived > 0 ? ` +${plusArrived}` : ''} · inside ✓`,
      );
    },
    [enqueueDoorWrite, eventId, meId],
  );

  // "Nog inchecken": raise plus_ones_arrived for a guest already inside. We read
  // the current arrivals + allotment from the live view and send the NEW absolute
  // target (capped client-side; the trigger caps + keeps it monotonic server-side).
  const topUp = useCallback(
    (guestId: string, addArrived: number) => {
      const g = guestMapRef.current.get(guestId);
      if (!g || !g.inside) return;
      const current = g.arrived ?? 0;
      const target = Math.min(g.plus, current + Math.max(0, addArrived));
      if (target <= current) return;
      const ts = new Date().toISOString();
      enqueueDoorWrite(
        { kind: 'check_in_topup', payload: { guestId, plusOnesArrived: target, clientTimestamp: ts } },
        (s) => ({
          ...s,
          checkIns: s.checkIns.map((c) =>
            c.guest_id === guestId ? { ...c, plus_ones_arrived: Math.max(c.plus_ones_arrived, target) } : c,
          ),
        }),
        `${g.name} · now ${1 + target} inside`,
      );
    },
    [enqueueDoorWrite],
  );

  // "Check-in terugdraaien": soft-void a mistaken check-in (#3 — never deleted).
  // The guest returns to "onderweg"; the row is flagged voided_at and excluded
  // from "aanwezig" everywhere. Any door-scoped colleague may do this (RLS).
  const voidCheckIn = useCallback(
    (guestId: string) => {
      const g = guestMapRef.current.get(guestId);
      if (!g || !g.inside) return;
      const ts = new Date().toISOString();
      enqueueDoorWrite(
        { kind: 'check_in_void', payload: { guestId, clientTimestamp: ts } },
        (s) => ({
          ...s,
          checkIns: s.checkIns.map((c) =>
            c.guest_id === guestId ? { ...c, voided_at: ts, voided_by: meId ?? '' } : c,
          ),
        }),
        `${g.name} · check-in reversed`,
      );
    },
    [enqueueDoorWrite, meId],
  );

  // "Opnieuw inchecken": revive a voided check-in (clears voided_at, re-sets
  // arrivals fresh — the cap trigger is revive-aware so it does not hold the old
  // count). Reuses the one row per guest (#11), so no new INSERT/duplicate.
  const reviveCheckIn = useCallback(
    (guestId: string, totalPeople: number) => {
      const g = guestMapRef.current.get(guestId);
      if (!g || !g.voided) return;
      const plusArrived = Math.min(g.plus, Math.max(0, totalPeople - 1));
      const ts = new Date().toISOString();
      enqueueDoorWrite(
        { kind: 'check_in_revive', payload: { guestId, plusOnesArrived: plusArrived, clientTimestamp: ts } },
        (s) => ({
          ...s,
          checkIns: s.checkIns.map((c) =>
            c.guest_id === guestId
              ? { ...c, voided_at: null, voided_by: null, checked_by: meId ?? '', checked_at: ts, plus_ones_arrived: plusArrived }
              : c,
          ),
        }),
        `${g.name}${plusArrived > 0 ? ` +${plusArrived}` : ''} · back inside ✓`,
      );
    },
    [enqueueDoorWrite, meId],
  );

  const refuse = useCallback(
    (guestId: string, reason: string) => {
      const id = uuidv7();
      const ts = new Date().toISOString();
      const g = guestMapRef.current.get(guestId);
      enqueueDoorWrite(
        { kind: 'refusal', payload: { id, guestId, reason, clientTimestamp: ts } },
        (s) => ({
          ...s,
          guests: s.guests.map((x) => (x.id === guestId ? { ...x, status: 'refused' as const } : x)),
          refusals: [
            ...s.refusals,
            {
              id,
              guest_id: guestId,
              event_id: eventId,
              venue_id: s.event.venueId,
              refused_by: meId ?? '',
              reason,
              refused_at: ts,
              client_timestamp: ts,
              device_id: getDeviceId(),
              created_at: ts,
              anonymized_at: null,
            },
          ],
        }),
        `${g?.name ?? 'Guest'} · refused`,
      );
    },
    [enqueueDoorWrite, eventId, meId],
  );

  // "Weigering ongedaan maken": re-admit a mistakenly refused guest. Status goes
  // back to 'approved' (→ onderweg); the refusal row stays as history (#10/#15).
  const undoRefusal = useCallback(
    (guestId: string) => {
      const g = guestMapRef.current.get(guestId); // map includes refused guests
      enqueueDoorWrite(
        { kind: 'undo_refusal', payload: { guestId, clientTimestamp: new Date().toISOString() } },
        (s) => ({
          ...s,
          guests: s.guests.map((x) => (x.id === guestId ? { ...x, status: 'approved' as const } : x)),
        }),
        `${g?.name ?? 'Guest'} · back on the list`,
      );
    },
    [enqueueDoorWrite],
  );

  const addOnSpot = useCallback(
    ({ name, plusOnes, tierId }: AddOnSpotInput) => {
      const id = uuidv7();
      const ts = new Date().toISOString();
      enqueueDoorWrite(
        { kind: 'add_guest', payload: { id, tierId, fullName: name, plusOnes } },
        (s) => {
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
            request_link_id: null,
            anonymized_at: null,
            removed_at: null,
            created_at: ts,
            updated_at: ts,
          };
          return { ...s, guests: [...s.guests, row] };
        },
        `${name}${plusOnes > 0 ? ` +${plusOnes}` : ''} · op de lijst`,
      );
    },
    [enqueueDoorWrite, eventId, meId],
  );

  const ackNote = useCallback(
    (guestId: string, ack: boolean) => {
      const ts = ack ? new Date().toISOString() : null;
      enqueueDoorWrite(
        { kind: 'ack_note', payload: { guestId, ack } },
        (s) => ({
          ...s,
          guests: s.guests.map((g) =>
            g.id === guestId ? { ...g, note_acknowledged_at: ts, note_acknowledged_by: ack ? meId ?? '' : null } : g,
          ),
        }),
        // no toast for ack
      );
    },
    [enqueueDoorWrite, meId],
  );

  // ── D2: Realtime patches — O(1) dedup via pre-built Sets instead of O(n) .some().
  // Sets are eagerly updated here before patchSnapshot so rapid-fire RT events from
  // 10 concurrent devices don't scan the full 1750-guest checkIns list on each hit.
  const onRealtimeCheckIn = useCallback(
    (row: CheckInRow) => {
      if (!guestIdSetRef.current.has(row.guest_id)) return; // not our event
      if (checkInIdSetRef.current.has(row.id) || checkInGuestIdSetRef.current.has(row.guest_id)) return; // already seen
      checkInIdSetRef.current.add(row.id);
      checkInGuestIdSetRef.current.add(row.guest_id);
      patchSnapshot((s) => ({ ...s, checkIns: [...s.checkIns, row] }));
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

  // ── D3: O(1) lookup via the map built in the view useMemo above.
  const guestById = useCallback((id: string) => guestMapRef.current.get(id), []);

  const value = useMemo<DoorContextValue>(
    () => ({
      eventId,
      view,
      tasks,
      quota: quotaQuery.data ?? null,
      defaultTierId,
      allowUncheck: view?.event.allowUncheck ?? true,
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
