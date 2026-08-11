// @vitest-environment jsdom
/**
 * Behavioural cover for the door's outbox housekeeping (86ey9e9p5).
 *
 * These drive the REAL provider — the outbox singleton, the real drain, the real
 * React Query cache — against a fake gateway that models the one server rule the
 * bugs hinge on: `check_ins.guest_id` is UNIQUE, so a second INSERT for a guest
 * who already has a row comes back 23505 (#11). Asserting on the queue and the
 * view instead of on internals is deliberate: all three defects were invisible
 * in unit terms and only showed up in the sequence a doorhost actually produces.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CheckInRow, DoorSnapshot, GuestRow, TierRow } from './queries';
import type { DbError, DoorGateway } from './outbox/gateway';

const EVENT_ID = 'ev1';
const VENUE_ID = 'v1';
const UID = 'u-door';
const GUEST_A = 'g-anna';
const GUEST_B = 'g-bram';

const QUOTA_FULL: DbError = { code: '45001', message: 'Quotum overschreden: dit zou 6 van 5 plekken gebruiken.' };
const TIER_FULL: DbError = { code: '45002', message: 'Tier zit vol: 11 van 10 plekken bezet.' };
const UNIQUE_GUEST: DbError = { code: '23505', details: 'Key (guest_id)=(...) already exists.' };

/** Mutable per-test wiring the hoisted vi.mock factories read lazily. */
const H = vi.hoisted(() => ({
  client: null as unknown,
  gateway: null as unknown,
  fetchSnapshot: null as null | (() => Promise<unknown>),
}));

vi.mock('@/lib/observability/sentry-client', () => ({
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
}));
vi.mock('./offline/idb', () => ({
  idbGet: vi.fn(async () => undefined),
  idbSet: vi.fn(async () => true),
  idbEpoch: vi.fn(() => 0),
}));
vi.mock('./offline/device', () => ({
  getDeviceId: () => 'device-test',
  getDoorClient: () => H.client,
}));
vi.mock('./outbox/gateway', () => ({ supabaseGateway: () => H.gateway }));
vi.mock('./queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./queries')>();
  return { ...actual, fetchDoorSnapshot: () => H.fetchSnapshot!(), fetchEventQuota: async () => null };
});

// Imported AFTER the mocks so the provider picks them up.
const { DoorProvider, useDoor, useDoorSyncStatus } = await import('./DoorProvider');
const { outbox } = await import('./outbox/store');

// ── fixtures ────────────────────────────────────────────────────────────────
function tier(): TierRow {
  return {
    id: 't-reg',
    event_id: EVENT_ID,
    venue_id: VENUE_ID,
    name: 'Regular',
    description: null,
    color: '#8A8A93',
    max_guests: null,
    aliases: [],
    door_price_cents: null,
    vat_percent: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  };
}

function guest(id: string, fullName: string): GuestRow {
  return {
    id,
    event_id: EVENT_ID,
    tier_id: 't-reg',
    full_name: fullName,
    phone: null,
    plus_ones: 0,
    note: null,
    note_priority: 'none',
    note_acknowledged_by: null,
    note_acknowledged_at: null,
    added_by: 'u-max',
    status: 'approved',
    created_at: '2026-08-01T12:00:00Z',
  };
}

function serverRow(guestId: string, plusOnesArrived: number): CheckInRow {
  return {
    id: `srv-${guestId}`,
    guest_id: guestId,
    event_id: EVENT_ID,
    venue_id: VENUE_ID,
    checked_by: UID,
    checked_at: '2026-08-10T23:00:00Z',
    client_timestamp: '2026-08-10T23:00:00Z',
    device_id: 'device-test',
    plus_ones_arrived: plusOnesArrived,
    offline_synced: true,
    created_at: '2026-08-10T23:00:00Z',
    voided_at: null,
    voided_by: null,
  };
}

function snapshotWith(checkIns: CheckInRow[]): DoorSnapshot {
  return {
    event: {
      id: EVENT_ID,
      venueId: VENUE_ID,
      name: 'FRENZY',
      venueName: 'De Marktkantine',
      status: 'open',
      listLocked: false,
      allowUncheck: true,
    },
    guests: [guest(GUEST_A, 'Anna'), guest(GUEST_B, 'Bram')],
    tiers: [tier()],
    checkIns,
    refusals: [],
    profiles: { 'u-max': 'Max', [UID]: 'Door' },
    fetchedAt: '2026-08-10T22:00:00Z',
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

// ── fake server + gateway ───────────────────────────────────────────────────
let serverCheckIns: CheckInRow[] = [];
let insertCalls: string[] = [];
/** guestId → error the server returns instead of accepting the INSERT. */
let rejects: Map<string, DbError>;
/** guestId → a gate that holds the INSERT open (models a slow drain). */
let gates: Map<string, { promise: Promise<void>; resolve: () => void }>;

function makeGateway(): DoorGateway {
  const ok = async () => ({ error: null });
  return {
    ...({ topUpCheckIn: ok, voidCheckIn: ok, reviveCheckIn: ok, insertRefusal: ok, undoRefusal: ok, insertGuest: ok, ackNote: ok } as unknown as DoorGateway),
    insertCheckIn: async (row) => {
      insertCalls.push(row.guest_id);
      const gate = gates.get(row.guest_id);
      if (gate) await gate.promise;
      const rejection = rejects.get(row.guest_id);
      if (rejection) return { error: rejection };
      // The real constraint: one check-in row per guest, ever (#11).
      if (serverCheckIns.some((c) => c.guest_id === row.guest_id)) return { error: UNIQUE_GUEST };
      serverCheckIns.push(serverRow(row.guest_id, row.plus_ones_arrived ?? 0));
      return { error: null };
    },
  };
}

// ── harness ─────────────────────────────────────────────────────────────────
type DoorApi = ReturnType<typeof useDoor>;
type SyncApi = ReturnType<typeof useDoorSyncStatus>;

function Probe({ door, sync }: { door: DoorApi[]; sync: SyncApi[] }): null {
  door.push(useDoor());
  sync.push(useDoorSyncStatus());
  return null;
}

function renderDoor() {
  const door: DoorApi[] = [];
  const sync: SyncApi[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <DoorProvider eventId={EVENT_ID} initialSnapshot={snapshotWith([])}>
        <Probe door={door} sync={sync} />
      </DoorProvider>
    </QueryClientProvider>,
  );
  return {
    ...utils,
    api: (): DoorApi => door[door.length - 1],
    sync: (): SyncApi => sync[sync.length - 1],
  };
}

const insideIds = (api: DoorApi): string[] => (api.view?.guests ?? []).filter((g) => g.inside).map((g) => g.id);

beforeEach(() => {
  serverCheckIns = [];
  insertCalls = [];
  rejects = new Map();
  gates = new Map();
  H.gateway = makeGateway();
  H.fetchSnapshot = async () => snapshotWith([...serverCheckIns]);
  H.client = {
    auth: {
      getUser: async () => ({ data: { user: { id: UID } } }),
      getSession: async () => ({ data: { session: { access_token: 'token' } } }),
    },
    realtime: { setAuth: vi.fn() },
    // Chainable no-op channel: realtime delivery is not what these test.
    channel: () => {
      const ch: Record<string, unknown> = {};
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    removeChannel: vi.fn(),
  };
  // The store is a module singleton shared by every test in this file.
  outbox.reset();
});

afterEach(() => {
  outbox.reset();
});

/** Let mount effects, the initial drain and its refetch settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('DoorProvider — double-tap on check-in (O8)', () => {
  it('enqueues exactly ONE check-in for two taps in the same frame', async () => {
    const h = renderDoor();
    await settle();

    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
      h.api().checkIn(GUEST_A, 1); // the second tap: same frame, same stale render refs
    });
    await waitFor(() => expect(insertCalls.filter((g) => g === GUEST_A)).toHaveLength(1));

    // The old code queued a second entry whose only possible outcome was
    // 23505-on-guest_id → `duplicate` → "Was already checked in on another
    // device", blaming a colleague for the doorhost's own double-tap.
    expect(serverCheckIns).toHaveLength(1);
    expect(h.api().toast).toBe('Anna · already inside');
    expect(insideIds(h.api())).toEqual([GUEST_A]);
    await waitFor(() => expect(h.api().pendingCount).toBe(0));
    expect(outbox.getSnapshot().some((e) => e.status === 'duplicate')).toBe(false);
  });

  it('blocks a tap on a guest a colleague already checked in, instead of queueing a doomed INSERT', async () => {
    // Realtime patches a peer's row straight into the cache; the guard reads
    // that same cache, so the tap answers locally instead of via a 23505.
    serverCheckIns = [serverRow(GUEST_A, 0)];
    const h = renderDoor();
    await settle();
    await waitFor(() => expect(insideIds(h.api())).toEqual([GUEST_A]));

    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });

    expect(insertCalls).toHaveLength(0);
    expect(h.api().toast).toBe('Anna · already inside');
  });

  it('still allows a retry after a check-in was terminally rejected', async () => {
    // A quota rejection creates no row, so the guest is NOT inside — the guard
    // must not turn the retry into a dead button once a slot frees up.
    rejects.set(GUEST_A, QUOTA_FULL);
    const h = renderDoor();
    await settle();

    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });
    await waitFor(() => expect(h.api().toast).toBe(QUOTA_FULL.message));

    rejects.delete(GUEST_A);
    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });
    await waitFor(() => expect(serverCheckIns).toHaveLength(1));
  });
});

describe('DoorProvider — a mutation enqueued while a flush is running (#32)', () => {
  it('drains it in the same cycle, so the check-in does not fall back to "onderweg"', async () => {
    const h = renderDoor();
    await settle();

    // Anna's INSERT hangs: the flush is now mid-drain.
    const gate = deferred();
    gates.set(GUEST_A, gate);
    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });
    await waitFor(() => expect(insertCalls).toContain(GUEST_A));

    // Bram is checked in DURING that flush — the everyday door case. His entry
    // is not in the drain's already-taken list, and his maybeFlush() gets handed
    // the in-flight promise.
    await act(async () => {
      h.api().checkIn(GUEST_B, 1);
    });
    expect(insideIds(h.api())).toEqual([GUEST_A, GUEST_B]); // optimistic

    // The drain finishes and refetches. That server snapshot predates Bram, so
    // it wipes his optimistic patch — before this fix nothing re-drained him and
    // he stayed "onderweg" until the 60s safety sync.
    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    await waitFor(() => expect(insertCalls).toContain(GUEST_B));
    await waitFor(() => expect(insideIds(h.api()).sort()).toEqual([GUEST_A, GUEST_B].sort()));
    await waitFor(() => expect(h.api().pendingCount).toBe(0));
    expect(serverCheckIns).toHaveLength(2);
  });
});

describe('DoorProvider — which failure the doorhost is shown (#33)', () => {
  it('toasts the rejection that just happened, not the oldest one still queued', async () => {
    rejects.set(GUEST_A, QUOTA_FULL);
    const h = renderDoor();
    await settle();

    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });
    await waitFor(() => expect(h.api().toast).toBe(QUOTA_FULL.message));

    // Anna's error entry is a tombstone now: it stays queued for the shift. The
    // old code find()-ed the first `error` in the store, so every later failure
    // in the night re-showed HER message.
    rejects.set(GUEST_B, TIER_FULL);
    await act(async () => {
      h.api().checkIn(GUEST_B, 1);
    });
    await waitFor(() => expect(h.api().toast).toBe(TIER_FULL.message));
  });

  it('retries terminal errors on a manual sync-nu press only', async () => {
    rejects.set(GUEST_A, QUOTA_FULL);
    const h = renderDoor();
    await settle();
    await act(async () => {
      h.api().checkIn(GUEST_A, 1);
    });
    await waitFor(() => expect(insertCalls.filter((g) => g === GUEST_A)).toHaveLength(1));

    // An unrelated mutation triggers an automatic flush. A dead-lettered entry
    // must NOT ride along on it, or the retry budget would mean nothing.
    await act(async () => {
      h.api().ackNote(GUEST_B, true);
    });
    await waitFor(() => expect(h.api().pendingCount).toBe(0));
    expect(insertCalls.filter((g) => g === GUEST_A)).toHaveLength(1);

    // The venue frees a slot and the doorhost presses "sync nu" — the only path
    // that re-queues errors, and until now it had no caller at all.
    rejects.delete(GUEST_A);
    await act(async () => {
      h.sync().forceSync();
    });
    await waitFor(() => expect(insertCalls.filter((g) => g === GUEST_A)).toHaveLength(2));
    await waitFor(() => expect(serverCheckIns.map((c) => c.guest_id)).toEqual([GUEST_A]));
  });
});
