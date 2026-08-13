'use client';

/**
 * Door orchestration: ties the cached snapshot (TanStack Query + IndexedDB) to
 * the offline outbox, realtime, and the sync-status bar, and exposes a small API
 * the screens consume. Every mutation is optimistic (patch the cached snapshot)
 * + queued (outbox) + flushed when online; realtime patches the same cache so
 * colleagues' check-ins appear within ~1s (spec §4, decisions #11/#25/#39).
 */
import type { JSX } from 'react';
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
import { useTransientValue } from '@/lib/use-transient-value';
import { setUser as sentrySetUser, setTag as sentrySetTag } from '@/lib/observability/sentry-client';
import { v7 as uuidv7 } from 'uuid';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import { addOnSpotSchema } from '@/features/guests/schemas';
import { getDeviceId, getDoorClient } from './offline/device';
import { drainOutbox, guestKeyOf } from './outbox/replay';
import { hasOpenCheckIn } from './outbox/dedup';
import { supabaseGateway } from './outbox/gateway';
import { outbox } from './outbox/store';
import { foreignEntries, hasUnsynced, isPending, type OutboxEntry } from './outbox/types';
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
/** Reruns of a flush that had work enqueued while it ran — see `flush` below. */
const MAX_COALESCED_RERUNS = 3;

const isOnline = (): boolean => typeof navigator === 'undefined' || navigator.onLine;

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

// Split off from DoorContextValue (86ey9e8gf): `sync` ticks every 15s and on
// every flush. Consumers: SyncBar (the status bar itself) and PoDoorTab
// (`useStaleResumeGuard`) — both need it; nothing else does, so bundling it
// into the broad context re-rendered CheckInList's virtual rows, GuestDetail,
// Taken and AddOnSpot on every tick for no reason.
const DoorSyncContext = createContext<DoorSyncState | null>(null);

export function useDoorSyncStatus(): DoorSyncState {
  const v = useContext(DoorSyncContext);
  if (!v) throw new Error('useDoorSyncStatus must be used within DoorProvider');
  return v;
}

// Split off from DoorContextValue (86ey9e9vc, #44 — see docs/changelog.md for
// why this survived #225's `sync` split and how it was re-verified).
// CheckInList is the only consumer; the state lives here (not locally in
// CheckInList) because opening a guest pushes a detail screen and the pop
// remounts the list — provider state is what keeps the filters selected
// across that remount (feedback Joeri 1/7). Local-first stays true: no server
// state, just a narrower context boundary.
interface DoorFiltersContextValue {
  listFilters: DoorListFilters;
  setListFilters: (patch: Partial<DoorListFilters>) => void;
}

const DoorFiltersContext = createContext<DoorFiltersContextValue | null>(null);

export function useDoorFilters(): DoorFiltersContextValue {
  const v = useContext(DoorFiltersContext);
  if (!v) throw new Error('useDoorFilters must be used within DoorProvider');
  return v;
}

// Split off from DoorContextValue (86ey9e9vc review, Step 0 Option A):
// `PoDoorTab` (screens/door.tsx) reads `useDoor()` directly in its own render
// body, so a context-value change forces it to re-render regardless of how
// stable its props/element are upstream — app.tsx's `<PoDoorTab>` element
// memo cannot bail a component out of its OWN context subscription. `toast`
// was PoDoorTab's only reason to read the broad (check-in- and realtime-
// churning) `value`; narrowing to just that field NARROWS PoDoorTab's
// re-render frequency, it does not eliminate it — `toast` itself still
// changes on this client's own check-ins (necessary: PoDoorTab renders the
// toast banner). Measured (DoorProvider.test.tsx): a broad-`useDoor()`-shaped
// probe re-renders strictly more on a check-in than a `useDoorToast()`-shaped
// one, and the narrow shape's own residual render is `toast` changing, not
// the `sync` tick. Full analysis in docs/changelog.md.
interface DoorToastContextValue {
  toast: string | null;
}

const DoorToastContext = createContext<DoorToastContextValue | null>(null);

export function useDoorToast(): DoorToastContextValue {
  const v = useContext(DoorToastContext);
  if (!v) throw new Error('useDoorToast must be used within DoorProvider');
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
  const [toast, showToast] = useTransientValue<string>(TOAST_MS);
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

  // Who is at this door. Since 86ey9et0h this is load-bearing rather than
  // cosmetic: it becomes the outbox entry's `ownerId`, i.e. the actor the row
  // will carry forever.
  //
  // `getUser()` VALIDATES against the auth server, so it fails offline and used
  // to leave `meId` null — on a door surface, offline is the normal case, not
  // the edge one. Any reload during an offline shift would then stamp every
  // subsequent check-in with no owner, silently degrading them to the old
  // drain-time attribution: exactly the bug this task exists to fix, and
  // invisible because the queue still syncs. `getSession()` reads local storage
  // with no network at all, so it answers while offline; we take it first and
  // let `getUser()` refine/confirm it when a connection exists (it also catches
  // a server-side revoke, which is why it is still called).
  useEffect(() => {
    const client = getDoorClient();
    let cancelled = false;
    void (async () => {
      const { data: sessionData } = await client.auth.getSession();
      if (!cancelled && sessionData.session?.user?.id) setMeId(sessionData.session.user.id);
      try {
        const { data } = await client.auth.getUser();
        if (!cancelled && data.user?.id) setMeId(data.user.id);
      } catch {
        // Offline: the local session above is the best answer available, and
        // it is the right one — a queued write belongs to whoever is signed in
        // on this device, which is precisely what storage records.
      }
    })();
    return () => {
      cancelled = true;
    };
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
    sentrySetUser({ id: meId });
    sentrySetTag('venue.id', doorVenueId ?? 'none');
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

  useEffect(() => {
    if (outboxPersistDegraded) showToast('Local storage unavailable — check-ins may not survive a reload');
  }, [outboxPersistDegraded, showToast]);

  // Ask before leaving with un-sent door writes (86ey9et0h, test feedback Max
  // 12-8). The queue itself survives a reload — it is in IndexedDB — but a
  // doorhost who reloads while offline lands on the browser's connection-error
  // page with no obvious way back, and cannot tell from there whether their
  // check-ins are safe. The browser owns the wording (a custom string has been
  // ignored since ~2016), so this buys the pause, not the message.
  //
  // Bound to un-sent work only: an unconditional handler would nag on every
  // ordinary navigation and train people to click through it, which is worse
  // than not having it at all.
  const hasUnsent = useMemo(() => hasUnsynced([...outboxEntries]), [outboxEntries]);
  useEffect(() => {
    if (!hasUnsent || typeof window === 'undefined') return;
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
      e.returnValue = ''; // required by Chrome to actually show the prompt
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hasUnsent]);

  const patchSnapshot = useCallback(
    (updater: (s: DoorSnapshot) => DoorSnapshot) => {
      queryClient.setQueryData<DoorSnapshot>(doorSnapshotKey(eventId), (prev) => (prev ? updater(prev) : prev));
    },
    [queryClient, eventId],
  );

  /** The cache as it is RIGHT NOW — `patchSnapshot` writes here synchronously,
   *  so this sees a mutation from the same frame that the render refs miss. */
  const readSnapshot = useCallback(
    () => queryClient.getQueryData<DoorSnapshot>(doorSnapshotKey(eventId)),
    [queryClient, eventId],
  );

  // ── Sync: drain the outbox, then refetch the snapshot + quota (when online).
  const runFlush = useCallback(async (): Promise<void> => {
    const client = getDoorClient();
    const {
      data: { user },
    } = await client.auth.getUser();
    if (user) {
      // Entries the PREVIOUS user of this tablet queued and never got online to
      // send (86ey9et0h). They drain under this session like any other — the
      // whole point is that a doorhost hand-off never costs a check-in — but the
      // rows keep naming whoever performed them, and the new doorhost is told
      // afterwards so the sync is visible rather than silent. Captured before the
      // drain because a settled entry is pruned by clearSettled() below.
      const foreignBefore = foreignEntries([...outbox.getSnapshot()].filter(isPending), user.id).map(
        (e) => e.clientId,
      );
      const summary = await drainOutbox({
        list: () => [...outbox.getSnapshot()],
        update: (id, patch) => outbox.update(id, patch),
        gateway: supabaseGateway(client),
        uid: user.id,
        deviceId: getDeviceId(),
      });
      if (foreignBefore.length > 0) {
        const ids = new Set(foreignBefore);
        const settled = outbox
          .getSnapshot()
          .filter((e) => ids.has(e.clientId) && (e.status === 'synced' || e.status === 'duplicate'));
        if (settled.length > 0) {
          // Say "check-ins" only when they all ARE check-ins. The queue also
          // carries refusals, door-adds, voids and note acks, and a toast on the
          // one screen whose entire purpose is accurate attribution must not
          // announce two refusals as "2 check-ins" (review of this PR).
          const n = settled.length;
          const noun = settled.every((e) => e.kind === 'check_in')
            ? `check-in${n === 1 ? '' : 's'}`
            : `door action${n === 1 ? '' : 's'}`;
          showToast(`${n} ${noun} from the previous user ${n === 1 ? 'was' : 'were'} synced`);
        }
      }
      if (summary.duplicates > 0) showToast('Was already checked in on another device');
      // The entry that JUST failed, carried out of the drain itself. Scanning the
      // store for the first `error` entry (the old code) returns the OLDEST one
      // still queued — since tombstones were never pruned, that meant a doorhost
      // whose check-in hit "tier zit vol" could be shown an unrelated rejection
      // from three hours earlier (#33).
      if (summary.lastError) showToast(summary.lastError);
      outbox.clearSettled();
    }
    if (isOnline()) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: doorSnapshotKey(eventId) }),
        queryClient.invalidateQueries({ queryKey: QUOTA_KEY(eventId) }),
      ]);
    }
  }, [eventId, queryClient, showToast]);

  const flushPromise = useRef<Promise<void> | null>(null);
  const flushQueued = useRef(false);
  /**
   * One flush at a time, but never a LOST flush (#32).
   *
   * `drainOutbox` snapshots the queue once, and the refetch that follows it
   * overwrites the cache with whatever the server has. So a mutation enqueued
   * while a flush is running — the doorhost checking in the next guest during
   * the ~1s drain+refetch, which at the door is the normal case, not the edge
   * case — used to be dropped twice over: its own `maybeFlush()` got handed the
   * in-flight promise and queued nothing, and then the in-flight refetch landed
   * a server snapshot that predates it and wiped its optimistic patch. The guest
   * visibly fell back to "onderweg" until the 60s safety sync picked the entry
   * up. Instead: remember that someone asked, and rerun the whole cycle
   * (drain THEN refetch) once the current one is done, so the last refetch of
   * the burst is always the one that already includes the new write.
   */
  const flush = useCallback((): Promise<void> => {
    if (flushPromise.current) {
      flushQueued.current = true;
      return flushPromise.current;
    }
    flushQueued.current = false;
    const run = (async () => {
      try {
        await runFlush();
        // Bounded: one rerun already drains an entire burst (the drain lists
        // every pending entry), and anything still queued after that is a
        // pathological loop, not a doorhost — the 60s safety sync remains the
        // backstop. Keeps termination provable on the door's hot path.
        for (let i = 0; i < MAX_COALESCED_RERUNS && flushQueued.current; i++) {
          flushQueued.current = false;
          if (!isOnline() || !outbox.getSnapshot().some(isPending)) break;
          await runFlush();
        }
      } finally {
        // Cleared in the same synchronous step as the final `flushQueued` read,
        // so no flush() call can land in a window where the rerun loop has given
        // up but the promise still looks in-flight (its request would be lost).
        flushPromise.current = null;
      }
    })();
    flushPromise.current = run;
    return run;
  }, [runFlush]);

  const maybeFlush = useCallback(() => {
    // Swallow here only: a mutation's fire-and-forget flush must not surface as
    // an unhandled rejection. useDoorSync awaits the same promise and keeps its
    // own error handling (it degrades the status bar to stale/warn).
    if (isOnline()) void flush().catch(() => {});
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
        // Who is doing this, recorded NOW rather than inferred at drain time
        // (86ey9et0h) — on a shared tablet the session can change between the
        // tap and the sync. `meId` is resolved by an effect on mount, so it is
        // set long before anyone taps a guest; a null here (an enqueue in the
        // very first frames) simply falls back to the drain-time uid in replay,
        // which is the pre-existing behaviour.
        ownerId: meId ?? undefined,
        ...write,
      } as OutboxEntry);
      patchSnapshot(patchFn);
      if (toastMsg) showToast(toastMsg);
      maybeFlush();
    },
    [eventId, meId, patchSnapshot, showToast, maybeFlush],
  );

  // ── Mutations (thin wrappers over enqueueDoorWrite).

  const checkIn = useCallback(
    (guestId: string, totalPeople: number) => {
      const g = guestMapRef.current.get(guestId);
      // O8 — guard the ENQUEUE, not just the optimistic patch. The patch below
      // is a no-op when the guest is already in the snapshot, but the entry was
      // queued regardless; `check_ins.guest_id` is UNIQUE, so that second entry
      // could only ever come back 23505 → `duplicate` → "Was already checked in
      // on another device" at a doorhost who just double-tapped their own
      // tablet. Both reads are deliberately synchronous state that the first tap
      // already mutated — the query cache (also patched by realtime, so a
      // colleague's check-in counts too) and the outbox — because two taps in
      // one frame share the same stale render refs (`guestMapRef`/`view`).
      const existing = readSnapshot()?.checkIns.find((c) => c.guest_id === guestId);
      if (existing || hasOpenCheckIn(outbox.getSnapshot(), eventId, guestId)) {
        // Never silent: the tap has to answer something, or the doorhost taps
        // again. A voided row is the revive path's business, not a fresh INSERT.
        showToast(
          existing?.voided_at
            ? `${g?.name ?? 'Guest'} · check-in was reversed — use re-check-in`
            : `${g?.name ?? 'Guest'} · already inside`,
        );
        return;
      }
      const ciId = uuidv7();
      const ts = new Date().toISOString();
      const plusArrived = Math.max(0, totalPeople - 1);
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
            // Optimistic row: this device is both actor and sender until proven
            // otherwise, and replay recomputes synced_by at drain time anyway.
            synced_by: null,
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
    [enqueueDoorWrite, eventId, meId, readSnapshot, showToast],
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
        // The observed row id travels with the entry: replayed hours later it
        // must still mean "undo THAT check-in", not "undo whatever check-in this
        // guest has by then" (#35).
        { kind: 'check_in_void', payload: { guestId, checkInId: g.checkInId, clientTimestamp: ts } },
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
        {
          kind: 'check_in_revive',
          payload: { guestId, plusOnesArrived: plusArrived, checkInId: g.checkInId, clientTimestamp: ts },
        },
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
              synced_by: null,
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

  // `onBeforeForceSync` fires on the sync-bar button only: a terminal error
  // (quota full, tier full, an RLS deny while the list was locked) had no way
  // back into the queue at all — `retryErrors` existed but nothing called it
  // (#33). Automatic drains must NOT retry them, or dead-lettering means nothing.
  const retryFailed = useCallback(() => outbox.retryErrors(), []);
  const sync = useDoorSync({
    eventId,
    onSync: flush,
    onBeforeForceSync: retryFailed,
    onRealtimeCheckIn,
    onRealtimeGuest,
  });

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
    [eventId, view, tasks, quotaQuery.data, defaultTierId, pendingCount, outboxByGuest, guestById, checkIn, topUp, voidCheckIn, reviveCheckIn, refuse, undoRefusal, addOnSpot, ackNote],
  );

  // Narrow contexts (see the comments on DoorFiltersContext/DoorToastContext
  // above) — only these objects' identities change on a keystroke / a toast
  // message, never the broad `value` above.
  const filtersValue = useMemo<DoorFiltersContextValue>(
    () => ({ listFilters, setListFilters }),
    [listFilters, setListFilters],
  );
  const toastValue = useMemo<DoorToastContextValue>(() => ({ toast }), [toast]);

  return (
    <DoorContext.Provider value={value}>
      <DoorSyncContext.Provider value={sync}>
        <DoorFiltersContext.Provider value={filtersValue}>
          <DoorToastContext.Provider value={toastValue}>{children}</DoorToastContext.Provider>
        </DoorFiltersContext.Provider>
      </DoorSyncContext.Provider>
    </DoorContext.Provider>
  );
}
