import { describe, expect, it, vi } from 'vitest';
import type { DbError, DoorGateway } from './gateway';
import { classifyError, drainOutbox, MAX_ATTEMPTS, replayEntry, type DrainDeps } from './replay';
import { resumeStuckEntries, type OutboxEntry } from './types';

const UID = '66666666-6666-4666-8666-666666666666';
const DEVICE = 'door-test-01';

function checkInEntry(over: Partial<OutboxEntry> = {}): OutboxEntry {
  const base: OutboxEntry = {
    clientId: 'c1',
    eventId: 'ev1',
    kind: 'check_in',
    status: 'pending',
    attempts: 0,
    createdAt: '2026-06-20T22:00:00.000Z',
    payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 1, clientTimestamp: '2026-06-20T22:00:00.000Z' },
  };
  return { ...base, ...over } as OutboxEntry;
}

/** A gateway that returns a fixed error for every method. */
function gatewayReturning(error: DbError | null): DoorGateway {
  const r = async () => ({ error });
  return { insertCheckIn: r, topUpCheckIn: r, voidCheckIn: r, reviveCheckIn: r, insertRefusal: r, undoRefusal: r, insertGuest: r, ackNote: r };
}

const UNIQUE_GUEST: DbError = { code: '23505', details: 'Key (guest_id)=(g1) already exists.' };
const UNIQUE_PKEY: DbError = { code: '23505', details: 'Key (id)=(ci1) already exists.' };
const QUOTA_FULL: DbError = { code: '45001', message: 'Quotum overschreden: dit zou 6 van 5 plekken gebruiken.' };
const TIER_FULL: DbError = { code: '45002', message: 'Tier zit vol: 11 van 10 plekken bezet.' };
const CAPACITY_FULL: DbError = {
  code: '45005',
  message: 'Capaciteit bereikt: dit zou 1801 van 1800 plekken voor dit event gebruiken.',
};
const NETWORK: DbError = { code: undefined, message: 'Failed to fetch' };
const RLS_DENY: DbError = { code: '42501', message: 'permission denied for table check_ins' };
const UNKNOWN_CODE: DbError = { code: 'XX999', message: 'unexpected postgres error' };

describe('classifyError', () => {
  it('treats no error as synced', () => {
    expect(classifyError(null)).toEqual({ status: 'synced' });
  });

  it('maps a guest_id unique violation to duplicate (#11 — first device wins)', () => {
    expect(classifyError(UNIQUE_GUEST).status).toBe('duplicate');
  });

  it('treats a primary-key conflict as idempotent success', () => {
    // Our own row was already persisted by an earlier replay.
    expect(classifyError(UNIQUE_PKEY)).toEqual({ status: 'synced' });
  });

  it('maps quota (45001), tier (45002), and capacity (45005) to terminal errors carrying the message', () => {
    expect(classifyError(QUOTA_FULL)).toEqual({ status: 'error', message: QUOTA_FULL.message });
    expect(classifyError(TIER_FULL)).toEqual({ status: 'error', message: TIER_FULL.message });
    expect(classifyError(CAPACITY_FULL)).toEqual({ status: 'error', message: CAPACITY_FULL.message });
  });

  it('treats a code-less (network) error as a pure transient retry, not a coded reject', () => {
    const r = classifyError(NETWORK);
    expect(r.status).toBe('pending');
    expect(r.codedReject).toBeFalsy();
  });

  it('classifies structurally-terminal codes (FK / RLS / CHECK / NOT-NULL) as terminal errors (C9)', () => {
    for (const code of ['23503', '42501', '23514', '23502']) {
      expect(classifyError({ code, message: 'x' }).status).toBe('error');
    }
  });

  it('flags an unrecognised CODED rejection as a coded reject that retries (C9)', () => {
    const r = classifyError(UNKNOWN_CODE);
    expect(r.status).toBe('pending');
    expect(r.codedReject).toBe(true);
  });
});

describe('replayEntry', () => {
  it('checks in: pins checked_by to the session user and stamps device + offline_synced', async () => {
    const insertCheckIn = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), insertCheckIn };
    const result = await replayEntry(gw, checkInEntry(), UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(insertCheckIn).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'ci1',
        guest_id: 'g1',
        checked_by: UID,
        plus_ones_arrived: 1,
        device_id: DEVICE,
        offline_synced: true,
      }),
    );
  });

  it('check-in duplicate surfaces as duplicate', async () => {
    const result = await replayEntry(gatewayReturning(UNIQUE_GUEST), checkInEntry(), UID, DEVICE);
    expect(result.status).toBe('duplicate');
  });

  it('check_in_topup updates by guest_id with the absolute target and syncs', async () => {
    const topUpCheckIn = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), topUpCheckIn };
    const entry: OutboxEntry = {
      clientId: 'c3',
      eventId: 'ev1',
      kind: 'check_in_topup',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T23:30:00.000Z',
      payload: { guestId: 'g1', plusOnesArrived: 4, clientTimestamp: '2026-06-20T23:30:00.000Z' },
    };
    const result = await replayEntry(gw, entry, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(topUpCheckIn).toHaveBeenCalledWith('g1', 4);
  });

  it('check_in_topup matching no row (another checker / not yet synced) is a harmless no-op', async () => {
    // An UPDATE that affects zero rows returns no error → synced, never duplicate.
    const result = await replayEntry(gatewayReturning(null), {
      clientId: 'c4',
      eventId: 'ev1',
      kind: 'check_in_topup',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T23:31:00.000Z',
      payload: { guestId: 'gX', plusOnesArrived: 2, clientTimestamp: '2026-06-20T23:31:00.000Z' },
    }, UID, DEVICE);
    expect(result.status).toBe('synced');
  });

  it('check_in_void voids by guest_id, pinning voided_by to the session user', async () => {
    const voidCheckIn = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), voidCheckIn };
    const result = await replayEntry(gw, {
      clientId: 'c5',
      eventId: 'ev1',
      kind: 'check_in_void',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T23:40:00.000Z',
      payload: { guestId: 'g1', clientTimestamp: '2026-06-20T23:40:00.000Z' },
    }, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(voidCheckIn).toHaveBeenCalledWith('g1', UID);
  });

  it('check_in_revive re-checks-in with fresh arrivals and the session user', async () => {
    const reviveCheckIn = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), reviveCheckIn };
    const result = await replayEntry(gw, {
      clientId: 'c6',
      eventId: 'ev1',
      kind: 'check_in_revive',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T23:50:00.000Z',
      payload: { guestId: 'g1', plusOnesArrived: 1, clientTimestamp: '2026-06-20T23:50:00.000Z' },
    }, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(reviveCheckIn).toHaveBeenCalledWith('g1', 1, UID);
  });

  it('add_guest carries source=door and the event id, and maps quota to error', async () => {
    const insertGuest = vi.fn(async () => ({ error: QUOTA_FULL }));
    const gw: DoorGateway = { ...gatewayReturning(null), insertGuest };
    const entry: OutboxEntry = {
      clientId: 'c2',
      eventId: 'ev1',
      kind: 'add_guest',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { id: 'gnew', tierId: 't1', fullName: 'Nina Driessen', plusOnes: 0 },
    };
    const result = await replayEntry(gw, entry, UID, DEVICE);
    expect(result.status).toBe('error');
    expect(insertGuest).toHaveBeenCalledWith(
      expect.objectContaining({ event_id: 'ev1', source: 'door', added_by: UID }),
    );
  });

  it('undo_refusal re-admits by guest_id and syncs', async () => {
    const undoRefusal = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), undoRefusal };
    const entry: OutboxEntry = {
      clientId: 'c7',
      eventId: 'ev1',
      kind: 'undo_refusal',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { guestId: 'g9', clientTimestamp: 't' },
    };
    const result = await replayEntry(gw, entry, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(undoRefusal).toHaveBeenCalledWith('g9');
  });

  it('refusal records the reason, pinning refused_by + event + device, and syncs', async () => {
    const insertRefusal = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), insertRefusal };
    const entry: OutboxEntry = {
      clientId: 'c8',
      eventId: 'ev1',
      kind: 'refusal',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { id: 'r1', guestId: 'g1', reason: 'Geen geldig ID', clientTimestamp: '2026-06-20T22:00:00.000Z' },
    };
    const result = await replayEntry(gw, entry, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(insertRefusal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'r1',
        guest_id: 'g1',
        event_id: 'ev1',
        refused_by: UID,
        reason: 'Geen geldig ID',
        device_id: DEVICE,
      }),
    );
  });

  it('refusal re-sent (own row already persisted) is idempotent → synced', async () => {
    const result = await replayEntry(gatewayReturning(UNIQUE_PKEY), {
      clientId: 'c9',
      eventId: 'ev1',
      kind: 'refusal',
      status: 'pending',
      attempts: 1,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { id: 'r1', guestId: 'g1', reason: 'Geen geldig ID', clientTimestamp: 't' },
    }, UID, DEVICE);
    expect(result.status).toBe('synced');
  });

  it('ack_note acknowledges by guest_id, pinning the session user', async () => {
    const ackNote = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), ackNote };
    const result = await replayEntry(gw, {
      clientId: 'c10',
      eventId: 'ev1',
      kind: 'ack_note',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { guestId: 'g1', ack: true },
    }, UID, DEVICE);
    expect(result.status).toBe('synced');
    expect(ackNote).toHaveBeenCalledWith('g1', true, UID);
  });

  it('ack_note reopen (ack=false) passes the flag through', async () => {
    const ackNote = vi.fn(async () => ({ error: null }));
    const gw: DoorGateway = { ...gatewayReturning(null), ackNote };
    await replayEntry(gw, {
      clientId: 'c11',
      eventId: 'ev1',
      kind: 'ack_note',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-06-20T22:00:00.000Z',
      payload: { guestId: 'g1', ack: false },
    }, UID, DEVICE);
    expect(ackNote).toHaveBeenCalledWith('g1', false, UID);
  });
});

/** In-memory stand-in for the persisted store. */
function fakeStore(entries: OutboxEntry[]) {
  return {
    entries,
    list: () => entries,
    update: (clientId: string, patch: Partial<OutboxEntry>) => {
      const i = entries.findIndex((e) => e.clientId === clientId);
      if (i >= 0) entries[i] = { ...entries[i], ...patch } as OutboxEntry;
    },
  };
}

describe('drainOutbox', () => {
  it('drains pending entries in FIFO order and marks them synced', async () => {
    const order: string[] = [];
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'b', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertCheckIn: async (row) => {
        order.push(row.guest_id);
        return { error: null };
      },
    };
    const deps: DrainDeps = { ...store, gateway: gw, uid: UID, deviceId: DEVICE };
    const summary = await drainOutbox(deps);
    expect(order).toEqual(['g1', 'g2']);
    expect(summary).toMatchObject({ processed: 2, synced: 2, duplicates: 0, errors: 0, interrupted: false });
    expect(store.entries.every((e) => e.status === 'synced')).toBe(true);
  });

  it('is idempotent: a second drain does nothing once entries are synced', async () => {
    const store = fakeStore([checkInEntry({ clientId: 'a' })]);
    const insertCheckIn = vi.fn(async () => ({ error: null }));
    const deps: DrainDeps = { ...store, gateway: { ...gatewayReturning(null), insertCheckIn }, uid: UID, deviceId: DEVICE };
    await drainOutbox(deps);
    await drainOutbox(deps);
    expect(insertCheckIn).toHaveBeenCalledTimes(1);
  });

  it('stops early on a transient failure, leaving later entries pending', async () => {
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'b', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const deps: DrainDeps = { ...store, gateway: gatewayReturning(NETWORK), uid: UID, deviceId: DEVICE };
    const summary = await drainOutbox(deps);
    expect(summary.interrupted).toBe(true);
    expect(summary.processed).toBe(1);
    expect(store.entries[0].status).toBe('pending');
    expect(store.entries[1].status).toBe('pending');
  });

  it('records a duplicate without blocking the rest of the queue', async () => {
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'b', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertCheckIn: async (row) => ({ error: row.guest_id === 'g1' ? UNIQUE_GUEST : null }),
    };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(summary).toMatchObject({ processed: 2, duplicates: 1, synced: 1, interrupted: false });
    expect(store.entries[0].status).toBe('duplicate');
    expect(store.entries[1].status).toBe('synced');
  });

  // C9 — a permanently-failing head must not wedge the writes behind it.
  it('does not wedge the queue on a terminal-coded head: it errors and the tail still syncs (C9)', async () => {
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'b', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertCheckIn: async (row) => ({ error: row.guest_id === 'g1' ? RLS_DENY : null }),
    };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(summary).toMatchObject({ processed: 2, errors: 1, synced: 1, interrupted: false });
    expect(store.entries[0].status).toBe('error'); // dead on arrival, not stuck pending
    expect(store.entries[1].status).toBe('synced'); // the write behind it still went through
  });

  it('skips past an unrecognised coded reject without pausing, so the tail syncs the same drain (C9)', async () => {
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'b', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertCheckIn: async (row) => ({ error: row.guest_id === 'g1' ? UNKNOWN_CODE : null }),
    };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(summary.interrupted).toBe(false); // alive connection — do not pause
    expect(store.entries[0].status).toBe('pending'); // retried later, still queued
    expect(store.entries[0].attempts).toBe(1);
    expect(store.entries[1].status).toBe('synced'); // not blocked behind the bad entry
  });

  it('dead-letters an unrecognised coded reject after MAX_ATTEMPTS instead of retrying forever (C9)', async () => {
    const store = fakeStore([
      checkInEntry({ clientId: 'a', attempts: MAX_ATTEMPTS - 1, payload: { id: 'a', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const summary = await drainOutbox({ ...store, gateway: gatewayReturning(UNKNOWN_CODE), uid: UID, deviceId: DEVICE });
    expect(summary).toMatchObject({ deadLettered: 1, errors: 1, interrupted: false });
    expect(store.entries[0].status).toBe('error');
    expect(store.entries[0].attempts).toBe(MAX_ATTEMPTS);
  });

  // O2 — a coded-reject predecessor for the SAME guest must not be skipped past:
  // the successor stays queued untouched rather than replaying out of order.
  it('blocks a same-guest successor behind a still-pending coded-reject predecessor (O2)', async () => {
    const insertCheckIn = vi.fn(async () => ({ error: null }));
    const store = fakeStore([
      {
        clientId: 'a',
        eventId: 'ev1',
        kind: 'add_guest',
        status: 'pending',
        attempts: 0,
        createdAt: 't',
        payload: { id: 'g1', tierId: 't1', fullName: 'Nina Driessen', plusOnes: 0 },
      } as OutboxEntry,
      checkInEntry({ clientId: 'b', payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = { ...gatewayReturning(null), insertGuest: async () => ({ error: UNKNOWN_CODE }), insertCheckIn };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(insertCheckIn).not.toHaveBeenCalled(); // never attempted out of order
    expect(summary.processed).toBe(1); // only the predecessor was touched
    expect(store.entries[0].status).toBe('pending');
    expect(store.entries[1]).toMatchObject({ status: 'pending', attempts: 0 }); // untouched, not skipped-and-marked
  });

  // O2 — a void queued behind a still-pending check-in for the same guest must
  // not run early: an out-of-order 0-row UPDATE must not be misread as synced.
  it('blocks a void behind a still-pending check-in for the same guest (O2)', async () => {
    const voidCheckIn = vi.fn(async () => ({ error: null }));
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      {
        clientId: 'b',
        eventId: 'ev1',
        kind: 'check_in_void',
        status: 'pending',
        attempts: 0,
        createdAt: 't',
        payload: { guestId: 'g1', clientTimestamp: 't' },
      } as OutboxEntry,
    ]);
    const gw: DoorGateway = { ...gatewayReturning(null), insertCheckIn: async () => ({ error: UNKNOWN_CODE }), voidCheckIn };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(voidCheckIn).not.toHaveBeenCalled();
    expect(summary.processed).toBe(1);
    expect(store.entries[1].status).toBe('pending'); // not misread as synced (0-row phantom)
  });

  // Once the predecessor settles (even within the same drain), the chain unblocks
  // and the successor for that guest still runs — no unnecessary serialization.
  it('unblocks a same-guest successor once the predecessor settles, in the same drain', async () => {
    const voidCheckIn = vi.fn(async () => ({ error: null }));
    const store = fakeStore([
      checkInEntry({ clientId: 'a', payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      {
        clientId: 'b',
        eventId: 'ev1',
        kind: 'check_in_void',
        status: 'pending',
        attempts: 0,
        createdAt: 't',
        payload: { guestId: 'g1', clientTimestamp: 't' },
      } as OutboxEntry,
    ]);
    const gw: DoorGateway = { ...gatewayReturning(null), voidCheckIn };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(voidCheckIn).toHaveBeenCalledWith('g1', UID);
    expect(summary).toMatchObject({ processed: 2, synced: 2 });
  });

  // O3 — a code-less network flap must not burn the coded-reject dead-letter
  // budget: MAX_ATTEMPTS-1 worth of prior coded rejects survives a network blip.
  it('does not increment attempts on a code-less network failure (O3)', async () => {
    const store = fakeStore([checkInEntry({ clientId: 'a', attempts: MAX_ATTEMPTS - 1 })]);
    const summary = await drainOutbox({ ...store, gateway: gatewayReturning(NETWORK), uid: UID, deviceId: DEVICE });
    expect(summary.interrupted).toBe(true);
    expect(store.entries[0]).toMatchObject({ status: 'pending', attempts: MAX_ATTEMPTS - 1 });
  });

  // A dead-lettered predecessor settles (even if failed) and does NOT block its
  // guest's chain — a later same-guest entry still runs in the same drain.
  it('a same-guest successor still runs in the same drain once its predecessor is dead-lettered', async () => {
    const insertCheckIn = vi.fn(async () => ({ error: null }));
    const store = fakeStore([
      checkInEntry({ clientId: 'a', attempts: MAX_ATTEMPTS - 1, payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
      checkInEntry({ clientId: 'b', payload: { id: 'ci2', guestId: 'g1', plusOnesArrived: 1, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertCheckIn: async (row) => (row.id === 'ci1' ? { error: UNKNOWN_CODE } : insertCheckIn(row)),
    };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(store.entries[0]).toMatchObject({ status: 'error', attempts: MAX_ATTEMPTS });
    expect(insertCheckIn).toHaveBeenCalled(); // not blocked behind the now-settled (dead-lettered) predecessor
    expect(summary).toMatchObject({ deadLettered: 1, synced: 1 });
  });

  // A terminal-error predecessor (e.g. add_guest hitting quota) settles and does
  // NOT block its guest's chain either — a same-guest successor (e.g. its
  // check_in) still attempts this same drain and independently discovers the
  // same root cause (the guest row was never created) as its own terminal error.
  it('a same-guest successor independently fails after a terminal-error predecessor, in the same drain', async () => {
    const store = fakeStore([
      {
        clientId: 'a',
        eventId: 'ev1',
        kind: 'add_guest',
        status: 'pending',
        attempts: 0,
        createdAt: 't',
        payload: { id: 'g1', tierId: 't1', fullName: 'Nina Driessen', plusOnes: 0 },
      } as OutboxEntry,
      checkInEntry({ clientId: 'b', payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' } }),
    ]);
    const gw: DoorGateway = {
      ...gatewayReturning(null),
      insertGuest: async () => ({ error: QUOTA_FULL }),
      insertCheckIn: async () => ({ error: { code: '23503', message: 'guest does not exist' } }),
    };
    const summary = await drainOutbox({ ...store, gateway: gw, uid: UID, deviceId: DEVICE });
    expect(store.entries[0].status).toBe('error'); // quota-full, terminal
    expect(store.entries[1].status).toBe('error'); // FK: attempted this same drain, independently terminal
    expect(summary).toMatchObject({ processed: 2, errors: 2 });
  });

  // C8 — an entry stranded in `syncing` by a mid-drain kill is resumed and replays.
  it('replays a killed-mid-drain entry: resumeStuckEntries → pending → synced (C8)', async () => {
    const store = fakeStore(resumeStuckEntries([checkInEntry({ clientId: 'a', status: 'syncing' })]));
    expect(store.entries[0].status).toBe('pending'); // revived on load
    const insertCheckIn = vi.fn(async () => ({ error: null }));
    const summary = await drainOutbox({ ...store, gateway: { ...gatewayReturning(null), insertCheckIn }, uid: UID, deviceId: DEVICE });
    expect(insertCheckIn).toHaveBeenCalledTimes(1); // the once-orphaned check-in is re-sent
    expect(summary.synced).toBe(1);
    expect(store.entries[0].status).toBe('synced');
  });
});
