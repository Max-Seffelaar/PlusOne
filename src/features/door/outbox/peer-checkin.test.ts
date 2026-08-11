/**
 * #35 — an offline void/revive must never hijack a PEER's fresh check-in
 * (86ey9e9q2, same C10 corruption class as the cockpit's revive fallback).
 *
 * check_ins.guest_id is UNIQUE, so a guest has exactly one row and a device that
 * queued writes while offline cannot tell "my row, still there" from "a different
 * check-in a colleague made in the meantime". Matching the replayed void/revive
 * on `guest_id` alone therefore reaches whatever row exists at drain time:
 *
 *   1. Doorhost A (offline) checks guest G in, undoes it, re-checks in — three
 *      queued entries against A's own client-generated row id.
 *   2. While A is offline, doorhost B checks G in for real at another door. B's
 *      row wins (#11) and owns the first-wins audit identity + instroom bucket.
 *   3. A reconnects. The insert correctly settles as `duplicate` — but the void
 *      then voids B's ACTIVE row (guest reads as onderweg while standing inside)
 *      and the revive stamps A over B's checked_by.
 *
 * The fix scopes both writes to the check_ins row the device actually observed,
 * so a peer's row (a different id) is a 0-row no-op = synced. This test drains a
 * real outbox against a gateway with the database's semantics and asserts the
 * resulting ROW STATE, so it fails against the guest_id-only implementation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { DoorGateway } from './gateway';
import { drainOutbox } from './replay';
import type { OutboxEntry } from './types';

const A_UID = '66666666-6666-4666-8666-666666666666'; // offline doorhost
const B_UID = '77777777-7777-4777-8777-777777777777'; // peer at another door
const GUEST = 'cc000000-0000-7000-8000-00000000b001';
const A_ROW = 'aa000000-0000-7000-8000-0000000000a1'; // A's client-generated id
const B_ROW = 'bb000000-0000-7000-8000-0000000000b1'; // the row B actually created

interface CheckInRowState {
  id: string;
  guest_id: string;
  checked_by: string;
  plus_ones_arrived: number;
  voided_at: string | null;
}

/**
 * In-memory `check_ins` with the constraints that matter here: guest_id is
 * unique (a second insert raises 23505 on guest_id), a void only matches an
 * active row, a revive only matches a voided one, and both may additionally be
 * scoped to a specific row id — exactly the filters the gateway sends.
 */
function fakeDb(seed: CheckInRowState[]) {
  const rows = [...seed];
  const find = (guestId: string, checkInId: string | null): CheckInRowState | undefined =>
    rows.find((r) => r.guest_id === guestId && (checkInId == null || r.id === checkInId));
  const gateway: DoorGateway = {
    insertCheckIn: async (row) => {
      if (rows.some((r) => r.guest_id === row.guest_id)) {
        return { error: { code: '23505', details: `Key (guest_id)=(${row.guest_id}) already exists.` } };
      }
      rows.push({
        id: row.id as string,
        guest_id: row.guest_id,
        checked_by: row.checked_by,
        plus_ones_arrived: row.plus_ones_arrived ?? 0,
        voided_at: null,
      });
      return { error: null };
    },
    topUpCheckIn: async (guestId, plusOnesArrived) => {
      const r = find(guestId, null);
      if (r) r.plus_ones_arrived = Math.max(r.plus_ones_arrived, plusOnesArrived);
      return { error: null };
    },
    voidCheckIn: async (guestId, uid, checkInId = null) => {
      const r = find(guestId, checkInId);
      if (r && r.voided_at == null) {
        r.voided_at = '2026-08-10T23:30:00.000Z';
        void uid;
      }
      return { error: null };
    },
    reviveCheckIn: async (guestId, plusOnesArrived, uid, checkInId = null) => {
      const r = find(guestId, checkInId);
      if (r && r.voided_at != null) {
        r.voided_at = null;
        r.checked_by = uid;
        r.plus_ones_arrived = plusOnesArrived;
      }
      return { error: null };
    },
    checkOutGuest: async () => ({ error: null }),
    insertRefusal: async () => ({ error: null }),
    undoRefusal: async () => ({ error: null }),
    insertGuest: async () => ({ error: null }),
    ackNote: async () => ({ error: null }),
  };
  return { rows, gateway };
}

function makeStore(entries: OutboxEntry[]) {
  const list = entries.map((e) => ({ ...e }));
  return {
    list: () => list,
    update: (clientId: string, patch: Partial<OutboxEntry>) => {
      const i = list.findIndex((e) => e.clientId === clientId);
      if (i >= 0) list[i] = { ...list[i], ...patch } as OutboxEntry;
    },
    entries: list,
  };
}

/** A's queued offline session: check in, undo, re-check-in — all on A's own row. */
function offlineSession(): OutboxEntry[] {
  const ts = '2026-08-10T22:00:00.000Z';
  return [
    {
      clientId: 'e1',
      eventId: 'ev1',
      status: 'pending',
      attempts: 0,
      createdAt: ts,
      kind: 'check_in',
      payload: { id: A_ROW, guestId: GUEST, plusOnesArrived: 3, clientTimestamp: ts },
    },
    {
      clientId: 'e2',
      eventId: 'ev1',
      status: 'pending',
      attempts: 0,
      createdAt: ts,
      kind: 'check_in_void',
      payload: { guestId: GUEST, checkInId: A_ROW, clientTimestamp: ts },
    },
    {
      clientId: 'e3',
      eventId: 'ev1',
      status: 'pending',
      attempts: 0,
      createdAt: ts,
      kind: 'check_in_revive',
      payload: { guestId: GUEST, checkInId: A_ROW, plusOnesArrived: 3, clientTimestamp: ts },
    },
  ];
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  // The state the server is in when A reconnects: B checked the guest in, alone.
  db = fakeDb([{ id: B_ROW, guest_id: GUEST, checked_by: B_UID, plus_ones_arrived: 0, voided_at: null }]);
});

describe('outbox replay vs a peer check-in (#35, 86ey9e9q2)', () => {
  it('leaves a peer\'s fresh check-in untouched — no void, no stolen identity', async () => {
    const store = makeStore(offlineSession());
    await drainOutbox({ list: store.list, update: store.update, gateway: db.gateway, uid: A_UID, deviceId: 'door-a' });

    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    // The guest is physically inside; a stale device must not flip them to onderweg.
    expect(row.voided_at).toBeNull();
    // First-wins audit identity (#11) + the instroom bucket stay with B.
    expect(row.checked_by).toBe(B_UID);
    expect(row.plus_ones_arrived).toBe(0);
  });

  it('settles every entry (the peer state is a no-op, never a wedged queue)', async () => {
    const store = makeStore(offlineSession());
    const summary = await drainOutbox({
      list: store.list,
      update: store.update,
      gateway: db.gateway,
      uid: A_UID,
      deviceId: 'door-a',
    });

    expect(summary.interrupted).toBe(false);
    expect(store.entries.map((e) => e.status)).toEqual(['duplicate', 'synced', 'synced']);
  });

  it('still applies A\'s own void + revive when the row IS A\'s (the normal offline flow)', async () => {
    db = fakeDb([]); // nothing on the server yet — A's insert creates the row
    const store = makeStore(offlineSession());
    await drainOutbox({ list: store.list, update: store.update, gateway: db.gateway, uid: A_UID, deviceId: 'door-a' });

    const row = db.rows[0];
    expect(row.id).toBe(A_ROW);
    expect(row.voided_at).toBeNull(); // voided then revived
    expect(row.checked_by).toBe(A_UID);
    expect(row.plus_ones_arrived).toBe(3);
  });

  it('falls back to guest-scoped matching for entries queued before the fix', async () => {
    // A doorhost upgrading mid-shift has entries without a checkInId in IndexedDB.
    // They must keep working (guest-scoped, pre-fix behaviour) rather than be
    // dropped — losing a queued check-in is worse than the narrow steal window.
    db = fakeDb([{ id: B_ROW, guest_id: GUEST, checked_by: B_UID, plus_ones_arrived: 2, voided_at: null }]);
    const legacy: OutboxEntry[] = [
      {
        clientId: 'e9',
        eventId: 'ev1',
        status: 'pending',
        attempts: 0,
        createdAt: '2026-08-10T22:00:00.000Z',
        kind: 'check_in_void',
        payload: { guestId: GUEST, clientTimestamp: '2026-08-10T22:00:00.000Z' },
      },
    ];
    const store = makeStore(legacy);
    await drainOutbox({ list: store.list, update: store.update, gateway: db.gateway, uid: A_UID, deviceId: 'door-a' });

    expect(db.rows[0].voided_at).not.toBeNull();
    expect(store.entries[0].status).toBe('synced');
  });
});
