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
import * as Sentry from '@sentry/nextjs';
import { v7 as uuidv7 } from 'uuid';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { addOnSpotSchema } from '@/features/guests/schemas';
import { getDeviceId, getDoorClient } from './offline/device';
import { drainOutbox, guestKeyOf } from './outbox/replay';
import { supabaseGateway } from './outbox/gateway';
import { outbox } from './outbox/store';
import type { OutboxEntry } from './outbox/types';
import { useDoorSync, type DoorSyncState } from './sync/useDoorSync';
import {
  doorSnapshotKey,
  fetchDoorSnapshot,
  fetchEventQuota,
  projectDoorGuest,
  type CheckInRow,
  type DoorSnapshot,
  type GuestRow,
  type GuestRowFull,
  type QuotaStatus,
} from './queries';
import { buildDoorView, buildTasks, type DoorGuest, type DoorTask, type DoorView } from './model';
import type { Filter } from './components/checkin-items';

/**
 * Check-in list filters (search / segment / tier chips). They live HERE, not in
 * CheckInList, because opening a guest to check them in pushes a detail screen
 * and the pop REMOUNTS the list — local state would snap the segment back to
 * "All" mid-shift (feedback Joeri 1/7). Scoped to the provider's event via the
 * eventId guard below so a filter never leaks into another event, and kept
 * in-memory only (local-first — no server state for door filtering).
 */
export interface DoorListFilters {
  q: string;
  f: Filter;
  tierIds: Set<string>;
}

const DEFAULT_LIST_FILTERS: DoorListFilters = { q: '', f: 'both', tierIds: new Set() };

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
  /** Check-in list filters — survive the guest-detail push/pop (see above). */
  listFilters: DoorListFilters;
  setListFilters: (patch: Partial<DoorListFilters>) => void;
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
  /** Returns false (and toasts) when the payload fails validation — the caller
   *  must not treat the guest as added (86ey9e8bd: a doorhost must never see a
   *  false "on the list" confirmation for a write that was actually rejected). */
  addOnSpot: (input: AddOnSpotInput) => boolean;
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
  // List filters, tagged with the event they belong to: the provider stays
  // mounted across an event switch (same tree position), so a stale tag means
  // "different event → start from the defaults" instead of leaking filters.
  const [listFiltersFor, setListFiltersFor] = useState<{ eventId: string; filters: DoorListFilters }>({
    eventId,
    filters: DEFAULT_LIST_FILTERS,
  });
  const listFilters = listFiltersFor.eventId === eventId ? listFiltersFor.filters : DEFAULT_LIST_FILTERS;
  const setListFilters = useCallback(
    (patch: Partial<DoorListFilters>) =>
      setListFiltersFor((prev) => ({
        eventId,
        filters: { ...(prev.eventId === eventId ? prev.filters : DEFAULT_LIST_FILTERS), ...patch },
      })),
    [eventId],
  );
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Outbox: load once, subscribe for re-render.
  useEffect(() => {
    void outbox.init();
  }, []);
  const outboxEntries = useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getServerSnapshot);
  // O4: IndexedDB write failures no longer vanish silently — Sentry sees every
  // one (store.ts), and the doorhost gets a one-time heads-up via the toast.
  const outboxPersistDegraded = useSyncExternalStore(
    outbox.subscribeStatus,
    outbox.getStatusSnapshot,
    outbox.getStatusServerSnapshot,
  );

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

  // Sentry diagnostic context for the door surface (fase 4.3): UUID user + venue
  // tag, same as PoLiveProvider. UUIDs are not guest PII; email/ip are never set.
  // The door pathway itself (outbox/replay) stays untouched — its classified
  // outcomes (45xxx business, offline, duplicate) are all expected = noise.
  const doorVenueId = snapshot?.event.venueId ?? null;
  useEffect(() => {
    if (!meId) return;
    Sentry.setUser({ id: meId });
    Sentry.setTag('venue.id', doorVenueId ?? 'none');
  }, [meId, doorVenueId]);

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
      const guestId = guestKeyOf(e);
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

  useEffect(() => {
    if (outboxPersistDegraded) showToast('Local storage unavailable — check-ins may not survive a reload');
  }, [outboxPersistDegraded, showToast]);

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
      const fullName = name.trim();
      if (!fullName) return false; // never queue a nameless guest (C12 — defence in depth)
      // The outbox replay inserts this payload directly (no server action
      // re-validates it), so it must pass the same caps as every other guest
      // write BEFORE it is even enqueued (86ey9e8bd) — never trust the parser.
      // The parser's explicit +N/pN triggers have no upper bound of their own
      // (unlike the bare-trailing-number fallback), so an exempt door user can
      // still type e.g. "Anna p9999999" past the UI's own quota gate — this
      // Zod check is the real boundary, and the caller MUST treat a `false`
      // return as "nothing was added", not silently confirm it.
      const parsed = addOnSpotSchema.safeParse({ fullName, plusOnes, tierId });
      if (!parsed.success) {
        showToast("Couldn't add that guest — check the name and +N");
        return false;
      }
      const id = uuidv7();
      const ts = new Date().toISOString();
      enqueueDoorWrite(
        { kind: 'add_guest', payload: { id, tierId: parsed.data.tierId, fullName: parsed.data.fullName, plusOnes: parsed.data.plusOnes } },
        (s) => {
          // Narrow snapshot row (P-IDB7) — only the door-rendered columns. The
          // full row (venue_id, source, timestamps, …) is filled server-side; the
          // outbox add_guest replay is the source of truth for what gets inserted.
          const row: GuestRow = {
            id,
            event_id: eventId,
            tier_id: parsed.data.tierId,
            full_name: parsed.data.fullName,
            phone: null,
            plus_ones: parsed.data.plusOnes,
            note: null,
            note_priority: 'none',
            note_acknowledged_by: null,
            note_acknowledged_at: null,
            added_by: meId ?? '',
            status: 'approved',
            created_at: ts,
          };
          return { ...s, guests: [...s.guests, row] };
        },
        `${parsed.data.fullName}${parsed.data.plusOnes > 0 ? ` +${parsed.data.plusOnes}` : ''} · op de lijst`,
      );
      return true;
    },
    [enqueueDoorWrite, eventId, meId, showToast],
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
      if (checkInIdSetRef.current.has(row.id)) {
        // Known row → this is an UPDATE (a peer's void / revive / top-up). Patch
        // it in place so voided_at / plus_ones_arrived propagate within ~1s
        // instead of waiting for the 60s safety sync (C11). The model derives
        // "inside" from voided_at, so this flips the headcount immediately.
        patchSnapshot((s) => ({
          ...s,
          checkIns: s.checkIns.map((c) => (c.id === row.id ? row : c)),
        }));
        return;
      }
      if (checkInGuestIdSetRef.current.has(row.guest_id)) return; // first-wins: another row already covers this guest
      checkInIdSetRef.current.add(row.id);
      checkInGuestIdSetRef.current.add(row.guest_id);
      patchSnapshot((s) => ({ ...s, checkIns: [...s.checkIns, row] }));
    },
    [patchSnapshot],
  );

  const onRealtimeGuest = useCallback(
    (full: GuestRowFull) => {
      if (full.event_id !== eventId) return;
      // Project to the narrow snapshot shape BEFORE it touches the cache, so a
      // realtime payload can't reintroduce dropped PII (email, …) into IndexedDB
      // (P-IDB7). Keep refused too — the door shows a "Geweigerd" lijst; only
      // pending/denied/removed drop out of the snapshot.
      const row = projectDoorGuest(full);
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
      listFilters,
      setListFilters,
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
    [eventId, view, tasks, quotaQuery.data, defaultTierId, sync, toast, pendingCount, outboxByGuest, listFilters, setListFilters, guestById, checkIn, topUp, voidCheckIn, reviveCheckIn, refuse, undoRefusal, addOnSpot, ackNote],
  );

  return <DoorContext.Provider value={value}>{children}</DoorContext.Provider>;
}
