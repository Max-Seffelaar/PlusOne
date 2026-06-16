'use client';

/**
 * Live door adapter for the polished prototype screens (Deur / Taken).
 *
 * The /app mobile shell renders inside `PoLiveProvider` (a plain TanStack Query
 * client + Supabase session), NOT the dedicated `/door/[eventId]` route with its
 * `DoorProvider`/IndexedDB-persisted client. So rather than mount a second
 * provider, this hook reuses the door feature's EXISTING backend primitives and
 * exposes them in the shapes the prototype screens already render:
 *
 *  - reads          → `fetchDoorSnapshot` + `doorSnapshotKey` (USER-scoped client,
 *                      so RLS is the boundary — a doorhost sees the venue's
 *                      guests; check_ins/refusals are scoped to those guests);
 *  - view model     → the pure, tested `buildDoorView` / `buildTasks`;
 *  - check-in/ack   → the offline OUTBOX singleton (`outbox` + `drainOutbox` +
 *                      `supabaseGateway`), so every write is an idempotent upsert
 *                      with a client-generated UUIDv7 (decision #25, #11) — we
 *                      never INSERT check_ins directly;
 *  - realtime/sync  → `useDoorSync` (colleague check-ins land in ~1s, delta-sync
 *                      on focus/reconnect, 60s safety floor).
 *
 * The screens keep their JSX/classes; only their data source changes. Search and
 * filtering stay LOCAL in the screen (no server state — CLAUDE.md).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { v7 as uuidv7 } from 'uuid';
import type { Guest, Priority, Role } from '@/lib/po/types';
import type { CheckInEntry } from '@/components/po/context';
import { getDeviceId, getDoorClient } from '@/features/door/offline/device';
import { drainOutbox } from '@/features/door/outbox/replay';
import { supabaseGateway } from '@/features/door/outbox/gateway';
import { outbox } from '@/features/door/outbox/store';
import { useDoorSync } from '@/features/door/sync/useDoorSync';
import {
  doorSnapshotKey,
  fetchDoorSnapshot,
  type CheckInRow,
  type DoorSnapshot,
  type GuestRow,
} from '@/features/door/queries';
import {
  buildDoorView,
  buildTasks,
  formatTime,
  indexCheckIns,
  type DoorGuest,
} from '@/features/door/model';

const TOAST_MS = 2400;

/** Tasks for the Taken tab, in the prototype's `{ g, prio, done }` triple shape. */
export interface PoDoorTask {
  g: Guest;
  prio: Priority;
  done: boolean;
}

export interface PoDoorState {
  /** Live guests for this event, mapped to the prototype Guest shape. */
  guests: Guest[];
  /** guest ids currently inside (a check_in row exists). Mirrors usePo().inside. */
  inside: Set<string>;
  /** guest id → { at, by } for the "ingecheckt om / door" line. */
  log: Record<string, CheckInEntry>;
  /** Note opdrachten for the Taken tab (BELANGRIJK first is applied by the screen). */
  tasks: PoDoorTask[];
  /** Event name + venue, for the screen subheaders ("FRENZY · De Marktkantine"). */
  eventName: string;
  venueName: string;
  isLoading: boolean;
  /** True while the snapshot has never loaded (offline first paint with no cache). */
  isEmpty: boolean;
  /** A one-shot toast string, cleared after a few seconds. */
  toast: string | null;
  /** Check a guest in for `total` people (1 + plus-ones arrived). Idempotent. */
  checkIn: (guestId: string, total: number) => void;
  /** Raise an already-inside guest's arrival count to `total` people (incremental
   *  "nog inchecken"). Capped at the allotment + kept monotonic server-side. */
  setArrival: (guestId: string, total: number) => void;
  /** Undo a mistaken check-in: the guest returns to "onderweg". Always allowed for
   *  door staff, audited (decision: Max, 16 jun). Offline-tolerant via the outbox. */
  voidCheckIn: (guestId: string) => void;
  /** Toggle a note opdracht acknowledged (same field as the door "Let op!" popup). */
  ackTask: (guestId: string, done: boolean) => void;
  /** True for a guest whose note opdracht is acknowledged. */
  taskDone: (guestId: string) => boolean;
}

// The prototype Guest.role is a fixed example union; live tiers are free-form
// (#8). `buildDoorView` already collapses a tier name to a RoleChip label via
// `tierRole`; map that label onto the closest prototype Role for icon/colour.
function roleFromTierLabel(label: string): Role {
  switch (label) {
    case 'VIP':
      return 'VIP';
    case 'All Access':
      return 'All Access';
    case 'Artist':
      return 'Artist';
    case 'Pers':
      return 'Pers';
    case 'Crew':
      return 'Crew';
    default:
      return 'Gast';
  }
}

/** Pure: a live DoorGuest → the prototype Guest the Deur/Taken screens render. */
export function toPoGuest(g: DoorGuest): Guest {
  return {
    id: g.id,
    name: g.name,
    role: roleFromTierLabel(g.tierName),
    // door_price is inert until the column lands (#34); never invent a fee.
    pay: g.pay ? 'pay' : 'free',
    plus: g.plus,
    note: g.note ?? '',
    flag: g.notePriority === 'high' ? ('high' as Priority) : g.note ? ('low' as Priority) : null,
    by: g.addedByName,
    addedAt: g.addedAt,
    status: g.inside ? 'in' : 'wait',
    at: g.inAt,
    inBy: g.inByName,
    arrived: g.arrived,
  };
}

/**
 * Adapt the live door snapshot for one event into the prototype Deur/Taken
 * shapes, with an idempotent outbox-backed check-in. Returns a mock-free empty
 * state when `eventId` is undefined so the caller can show a "Binnenkort"
 * affordance (the /app shell hasn't picked an event yet).
 */
export function usePoDoor(eventId: string | undefined): PoDoorState {
  const queryClient = useQueryClient();
  const [meId, setMeId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The outbox is a module singleton shared with the /door route: load persisted
  // entries once, then subscribe so optimistic state survives a reload.
  useEffect(() => {
    void outbox.init();
  }, []);
  useSyncExternalStore(outbox.subscribe, outbox.getSnapshot, outbox.getServerSnapshot);

  useEffect(() => {
    let active = true;
    getDoorClient()
      .auth.getSession()
      .then(({ data }) => {
        if (active) setMeId(data.session?.user?.id ?? null);
      });
    return () => {
      active = false;
    };
  }, []);

  const snapshotQuery = useQuery({
    queryKey: eventId ? doorSnapshotKey(eventId) : ['door', '__none__'],
    queryFn: () => fetchDoorSnapshot(getDoorClient(), eventId as string),
    enabled: Boolean(eventId),
  });

  const snapshot = snapshotQuery.data;
  const view = useMemo(() => (snapshot ? buildDoorView(snapshot) : null), [snapshot]);
  const viewRef = useRef(view);
  viewRef.current = view;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  const patchSnapshot = useCallback(
    (updater: (s: DoorSnapshot) => DoorSnapshot) => {
      if (!eventId) return;
      queryClient.setQueryData<DoorSnapshot>(doorSnapshotKey(eventId), (prev) =>
        prev ? updater(prev) : prev,
      );
    },
    [queryClient, eventId],
  );

  // ── Sync: drain the outbox (idempotent replay), then refetch the snapshot.
  const flushPromise = useRef<Promise<void> | null>(null);
  const flush = useCallback((): Promise<void> => {
    if (!eventId) return Promise.resolve();
    if (flushPromise.current) return flushPromise.current;
    const run = (async () => {
      const client = getDoorClient();
      // Local session read (no network) — only the uid is needed to attribute the
      // outbox replay; the check_in INSERT is still authorised by RLS server-side.
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
        await queryClient.invalidateQueries({ queryKey: doorSnapshotKey(eventId) });
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

  // ── Check-in: optimistic snapshot patch + outbox enqueue + flush (#25/#11).
  const checkIn = useCallback(
    (guestId: string, total: number) => {
      if (!eventId) return;
      const ciId = uuidv7();
      const ts = new Date().toISOString();
      const plusArrived = Math.max(0, total - 1);
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

  // ── Raise arrivals for an already-inside guest (incremental "nog inchecken").
  // Sets a target cumulative count; the DB trigger caps + keeps it monotonic, so
  // the optimistic patch + any replay can never exceed the allotment (#22/#25).
  const setArrival = useCallback(
    (guestId: string, total: number) => {
      if (!eventId) return;
      const guest = viewRef.current?.guests.find((x) => x.id === guestId);
      const cap = guest ? guest.plus : Math.max(0, total - 1);
      const target = Math.min(Math.max(0, total - 1), cap);
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'set_arrival',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        payload: { guestId, plusOnesArrived: target },
      });
      patchSnapshot((s) => ({
        ...s,
        checkIns: s.checkIns.map((c) =>
          c.guest_id === guestId ? { ...c, plus_ones_arrived: Math.max(c.plus_ones_arrived, target) } : c,
        ),
      }));
      showToast(`${guest?.name ?? 'Gast'} · ${target + 1} binnen ✓`);
      maybeFlush();
    },
    [eventId, patchSnapshot, showToast, maybeFlush],
  );

  // ── Void a check-in (correctie aan de deur): drop the guest's check_ins row so
  // they go back to "onderweg". Optimistic snapshot patch + outbox delete (#25);
  // the DB DELETE is RLS-gated (door staff) + audited as a 'delete'.
  const voidCheckIn = useCallback(
    (guestId: string) => {
      if (!eventId) return;
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'void_check_in',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        payload: { guestId },
      });
      patchSnapshot((s) => ({
        ...s,
        checkIns: s.checkIns.filter((c) => c.guest_id !== guestId),
      }));
      const g = viewRef.current?.guests.find((x) => x.id === guestId);
      showToast(`${g?.name ?? 'Gast'} · uitgecheckt`);
      maybeFlush();
    },
    [eventId, patchSnapshot, showToast, maybeFlush],
  );

  // ── Ack note opdracht (same note_acknowledged_* field as the door popup).
  const ackTask = useCallback(
    (guestId: string, done: boolean) => {
      if (!eventId) return;
      const ts = done ? new Date().toISOString() : null;
      outbox.enqueue({
        clientId: uuidv7(),
        eventId,
        kind: 'ack_note',
        status: 'pending',
        attempts: 0,
        createdAt: new Date().toISOString(),
        payload: { guestId, ack: done },
      });
      patchSnapshot((s) => ({
        ...s,
        guests: s.guests.map((g) =>
          g.id === guestId
            ? { ...g, note_acknowledged_at: ts, note_acknowledged_by: done ? meId ?? '' : null }
            : g,
        ),
      }));
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, maybeFlush],
  );

  // ── Realtime patches → instant colleague check-ins / guest changes (deduped).
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
      if (!eventId || row.event_id !== eventId) return;
      const keep = row.status === 'approved' || row.status === 'checked_in';
      patchSnapshot((s) => {
        const without = s.guests.filter((g) => g.id !== row.id);
        return { ...s, guests: keep ? [...without, row] : without };
      });
    },
    [eventId, patchSnapshot],
  );

  // useDoorSync owns a realtime channel + delta-sync; only run it for a real
  // event. The hook order is stable because eventId is set before mount in /app.
  useDoorSync({
    eventId: eventId ?? '',
    onSync: flush,
    onRealtimeCheckIn,
    onRealtimeGuest,
  });

  // ── Map the view onto the prototype shapes the screens render.
  const guests = useMemo<Guest[]>(() => (view ? view.guests.map(toPoGuest) : []), [view]);

  const inside = useMemo<Set<string>>(
    () => new Set((view?.guests ?? []).filter((g) => g.inside).map((g) => g.id)),
    [view],
  );

  const log = useMemo<Record<string, CheckInEntry>>(() => {
    if (!snapshot) return {};
    const out: Record<string, CheckInEntry> = {};
    // Earliest check-in per guest wins (#11) — reuse the tested indexer.
    for (const [guestId, c] of indexCheckIns(snapshot.checkIns)) {
      out[guestId] = {
        at: formatTime(c.checked_at),
        by: snapshot.profiles[c.checked_by] ?? 'Deur',
      };
    }
    return out;
  }, [snapshot]);

  const tasks = useMemo<PoDoorTask[]>(() => {
    if (!view) return [];
    return buildTasks(view).map((t) => ({
      g: toPoGuest(t.guest),
      prio: t.high ? ('high' as Priority) : ('low' as Priority),
      done: t.done,
    }));
  }, [view]);

  const taskDone = useCallback(
    (guestId: string): boolean => tasks.find((t) => t.g.id === guestId)?.done ?? false,
    [tasks],
  );

  return {
    guests,
    inside,
    log,
    tasks,
    eventName: view?.event.name ?? '',
    venueName: view?.event.venueName ?? '',
    isLoading: snapshotQuery.isLoading,
    isEmpty: !view,
    toast,
    checkIn,
    setArrival,
    voidCheckIn,
    ackTask,
    taskDone,
  };
}
