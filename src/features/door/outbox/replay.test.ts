import { describe, expect, it, vi } from 'vitest';
import type { DbError, DoorGateway } from './gateway';
import { classifyError, drainOutbox, replayEntry, type DrainDeps } from './replay';
import type { OutboxEntry } from './types';

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
const NETWORK: DbError = { code: undefined, message: 'Failed to fetch' };

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

  it('maps quota (45001) and tier (45002) to terminal errors carrying the message', () => {
    expect(classifyError(QUOTA_FULL)).toEqual({ status: 'error', message: QUOTA_FULL.message });
    expect(classifyError(TIER_FULL)).toEqual({ status: 'error', message: TIER_FULL.message });
  });

  it('treats unknown/network errors as transient (retry)', () => {
    expect(classifyError(NETWORK).status).toBe('pending');
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
});
