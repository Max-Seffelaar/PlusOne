import { describe, expect, it } from 'vitest';
import { hasOpenCheckIn } from './dedup';
import type { OutboxEntry, OutboxStatus } from './types';

const EVENT = 'ev1';
const GUEST = 'g1';

function checkIn(clientId: string, status: OutboxStatus = 'pending', over: Partial<OutboxEntry> = {}): OutboxEntry {
  return {
    clientId,
    eventId: EVENT,
    kind: 'check_in',
    status,
    attempts: 0,
    createdAt: '2026-08-10T22:00:00.000Z',
    payload: { id: `ci-${clientId}`, guestId: GUEST, plusOnesArrived: 0, clientTimestamp: '2026-08-10T22:00:00.000Z' },
    ...over,
  } as OutboxEntry;
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

describe('hasOpenCheckIn (O8 — double-tap must not enqueue a second check_in)', () => {
  it('is false for an empty queue', () => {
    expect(hasOpenCheckIn([], EVENT, GUEST)).toBe(false);
  });

  it('is true while this guest has a queued check-in, whatever stage it is at', () => {
    // pending/syncing: not sent yet or in flight. synced: the row exists.
    // duplicate: another device's row exists — the guest is inside either way,
    // so a fresh INSERT would still collide on guest_id.
    for (const status of ['pending', 'syncing', 'synced', 'duplicate'] as const) {
      expect(hasOpenCheckIn([checkIn('a', status)], EVENT, GUEST)).toBe(true);
    }
  });

  it('is false once the check-in settled to error — no row was created, so a retry tap is allowed', () => {
    // Quota/tier/capacity/RLS rejections. The guest is NOT inside; blocking the
    // retry here would leave the doorhost with a dead button after the venue
    // frees a slot.
    expect(hasOpenCheckIn([checkIn('a', 'error')], EVENT, GUEST)).toBe(false);
  });

  it('is false after a void — the row exists but re-admitting goes through revive, not a new INSERT', () => {
    expect(hasOpenCheckIn([checkIn('a', 'synced'), voidEntry('b')], EVENT, GUEST)).toBe(false);
  });

  it('is true again after a revive following a void (FIFO: the last entry decides)', () => {
    const revive: OutboxEntry = {
      clientId: 'c',
      eventId: EVENT,
      kind: 'check_in_revive',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-10T22:10:00.000Z',
      payload: { guestId: GUEST, plusOnesArrived: 0, clientTimestamp: '2026-08-10T22:10:00.000Z' },
    };
    expect(hasOpenCheckIn([checkIn('a', 'synced'), voidEntry('b'), revive], EVENT, GUEST)).toBe(true);
  });

  it('ignores another guest and another event', () => {
    const otherGuest = checkIn('a', 'pending', { payload: { id: 'ci-x', guestId: 'g2', plusOnesArrived: 0, clientTimestamp: 'x' } });
    const otherEvent = checkIn('b', 'pending', { eventId: 'ev2' });
    expect(hasOpenCheckIn([otherGuest, otherEvent], EVENT, GUEST)).toBe(false);
  });

  it('ignores unrelated kinds for the same guest (refusal, note ack, top-up)', () => {
    const refusal: OutboxEntry = {
      clientId: 'r',
      eventId: EVENT,
      kind: 'refusal',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-10T22:00:00.000Z',
      payload: { id: 'rf1', guestId: GUEST, reason: 'ID', clientTimestamp: '2026-08-10T22:00:00.000Z' },
    };
    const ack: OutboxEntry = {
      clientId: 'n',
      eventId: EVENT,
      kind: 'ack_note',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-10T22:00:00.000Z',
      payload: { guestId: GUEST, ack: true },
    };
    // A top-up only ever follows a real check-in; on its own it must not claim
    // the guest is inside (it would block the actual check-in).
    const topUp: OutboxEntry = {
      clientId: 't',
      eventId: EVENT,
      kind: 'check_in_topup',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-10T22:00:00.000Z',
      payload: { guestId: GUEST, plusOnesArrived: 2, clientTimestamp: '2026-08-10T22:00:00.000Z' },
    };
    expect(hasOpenCheckIn([refusal, ack, topUp], EVENT, GUEST)).toBe(false);
  });
});
