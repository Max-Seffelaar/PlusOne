import { describe, expect, it } from 'vitest';
import { coalesceTarget, openCheckInId } from './dedup';
import type { CheckInRow, DoorGateway } from './gateway';
import { drainOutbox } from './replay';
import type { CheckInPayload, OutboxEntry, OutboxStatus } from './types';

const EVENT = 'ev1';
const GUEST = 'g1';

function checkIn(clientId: string, status: OutboxStatus = 'pending', over: Partial<CheckInPayload> = {}): OutboxEntry {
  return {
    clientId,
    eventId: EVENT,
    kind: 'check_in',
    status,
    attempts: 0,
    createdAt: '2026-08-10T22:00:00.000Z',
    payload: { id: `ci-${clientId}`, guestId: GUEST, plusOnesArrived: 0, clientTimestamp: '2026-08-10T22:00:00.000Z', ...over },
  };
}

function voidEntry(clientId: string, status: OutboxStatus = 'pending'): OutboxEntry {
  return {
    clientId,
    eventId: EVENT,
    kind: 'check_in_void',
    status,
    attempts: 0,
    createdAt: '2026-08-10T22:05:00.000Z',
    payload: { guestId: GUEST, clientTimestamp: '2026-08-10T22:05:00.000Z' },
  };
}

describe('openCheckInId — the row id the next tap must reuse (z8uq9m2vg6)', () => {
  it('is null for an empty queue', () => {
    expect(openCheckInId([], EVENT, GUEST)).toBeNull();
  });

  it('names the queued row while the check-in is pending, in flight, synced or a duplicate', () => {
    for (const status of ['pending', 'syncing', 'synced', 'duplicate'] as const) {
      expect(openCheckInId([checkIn('a', status)], EVENT, GUEST)).toBe('ci-a');
    }
  });

  it('is null once the check-in settled to error — no row was created, so the next tap starts fresh', () => {
    expect(openCheckInId([checkIn('a', 'error')], EVENT, GUEST)).toBeNull();
  });

  it('keeps the id across a void: the row stays (soft void, #3) and is revived, not re-inserted', () => {
    expect(openCheckInId([checkIn('a'), voidEntry('v')], EVENT, GUEST)).toBe('ci-a');
  });

  it('is scoped to the guest and the event', () => {
    expect(openCheckInId([checkIn('a')], EVENT, 'someone-else')).toBeNull();
    expect(openCheckInId([checkIn('a')], 'other-event', GUEST)).toBeNull();
  });
});

describe('coalesceTarget — a second tap replaces a still-pending one (last wins)', () => {
  it('returns the pending entry for the same row', () => {
    expect(coalesceTarget([checkIn('a')], EVENT, { id: 'ci-a', guestId: GUEST })).toBe('a');
  });

  it('never touches an entry that is already on the wire or settled', () => {
    for (const status of ['syncing', 'synced', 'duplicate', 'error'] as const) {
      expect(coalesceTarget([checkIn('a', status)], EVENT, { id: 'ci-a', guestId: GUEST })).toBeNull();
    }
  });

  it('does not reorder: a later write for the same guest blocks coalescing into an earlier check-in', () => {
    expect(coalesceTarget([checkIn('a'), voidEntry('v')], EVENT, { id: 'ci-a', guestId: GUEST })).toBeNull();
  });

  it('only merges the same actor\'s own tap: a hand-off on a shared tablet keeps A\'s entry A\'s (S4)', () => {
    const fromA = { ...checkIn('a'), ownerId: 'user-a' } as OutboxEntry;
    expect(coalesceTarget([fromA], EVENT, { id: 'ci-a', guestId: GUEST }, 'user-b')).toBeNull();
    expect(coalesceTarget([fromA], EVENT, { id: 'ci-a', guestId: GUEST }, 'user-a')).toBe('a');
  });

  it('does not merge different rows', () => {
    expect(coalesceTarget([checkIn('a')], EVENT, { id: 'ci-other', guestId: GUEST })).toBeNull();
  });
});

/**
 * The door's own sequence, end to end on the pure parts: two "Check in 1" taps
 * while offline, then the network returns. A tiny in-memory check_ins table
 * stands in for Postgres with the same upsert-on-id semantics.
 */
describe('two taps offline, online = one row with the last absolute count', () => {
  it('coalesces the taps and the drain writes one row', async () => {
    const queue: OutboxEntry[] = [];
    const tap = (plusOnesArrived: number, ts: string) => {
      const payload: CheckInPayload = {
        id: openCheckInId(queue, EVENT, GUEST) ?? 'row-1',
        guestId: GUEST,
        plusOnesArrived,
        clientTimestamp: ts,
      };
      const target = coalesceTarget(queue, EVENT, payload);
      if (target) {
        const i = queue.findIndex((e) => e.clientId === target);
        queue[i] = { ...queue[i], payload } as OutboxEntry;
      } else {
        queue.push({ clientId: `c${queue.length + 1}`, eventId: EVENT, kind: 'check_in', status: 'pending', attempts: 0, createdAt: ts, payload });
      }
    };
    // Offline: "Check in 1" (the guest), then "Check in 1" again (+1).
    tap(0, '2026-10-10T22:00:01.000Z');
    tap(1, '2026-10-10T22:00:04.000Z');
    expect(queue).toHaveLength(1);

    const table = new Map<string, CheckInRow>();
    const upsertCheckIn = async (row: CheckInRow) => {
      table.set(row.id!, { ...table.get(row.id!), ...row });
      return { error: null };
    };
    const unused = async () => ({ error: null });
    const gateway: DoorGateway = {
      insertCheckIn: unused,
      upsertCheckIn,
      topUpCheckIn: unused,
      voidCheckIn: unused,
      reviveCheckIn: unused,
      checkOutGuest: unused,
      insertRefusal: unused,
      undoRefusal: unused,
      insertGuest: unused,
      ackNote: unused,
    };
    const summary = await drainOutbox({
      list: () => queue,
      update: (id, patch) => {
        const i = queue.findIndex((e) => e.clientId === id);
        queue[i] = { ...queue[i], ...patch } as OutboxEntry;
      },
      gateway,
      uid: 'u1',
      deviceId: 'd1',
    });

    expect(summary.synced).toBe(1);
    expect([...table.values()]).toEqual([
      expect.objectContaining({
        id: 'row-1',
        guest_id: GUEST,
        plus_ones_arrived: 1,
        client_timestamp: '2026-10-10T22:00:04.000Z',
      }),
    ]);
  });
});
