import { describe, expect, it } from 'vitest';
import { buildEnvelope, mergeOutboxEntries, OUTBOX_BUSTER, parsePersistedOutbox } from './persistence';
import type { OutboxEntry, OutboxStatus } from './types';

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const CI_ID = '22222222-2222-4222-8222-222222222222';
const GUEST_ID = '33333333-3333-4333-8333-333333333333';

function entry(clientId: string, status: OutboxStatus, attempts = 0): OutboxEntry {
  return {
    clientId,
    eventId: EVENT_ID,
    kind: 'check_in',
    status,
    attempts,
    createdAt: '2026-07-13T20:00:00.000Z',
    payload: { id: CI_ID, guestId: GUEST_ID, plusOnesArrived: 0, clientTimestamp: '2026-07-13T20:00:00.000Z' },
  };
}

describe('parsePersistedOutbox (O9 — corrupt/stale-shape safety)', () => {
  it('treats nothing persisted yet as an empty, non-dropped load', () => {
    expect(parsePersistedOutbox(undefined)).toEqual({ entries: [], droppedInvalid: 0, droppedStaleShape: false });
    expect(parsePersistedOutbox(null)).toEqual({ entries: [], droppedInvalid: 0, droppedStaleShape: false });
  });

  it('quarantines the legacy bare-array shape (pre-fix persistence) instead of casting it', () => {
    const out = parsePersistedOutbox([entry('c1', 'pending')]);
    expect(out).toEqual({ entries: [], droppedInvalid: 0, droppedStaleShape: true });
  });

  it('quarantines a stale/mismatched buster', () => {
    const out = parsePersistedOutbox({ buster: 'door-outbox-v0', entries: [entry('c1', 'pending')] });
    expect(out.droppedStaleShape).toBe(true);
    expect(out.entries).toEqual([]);
  });

  it('quarantines any other corrupt shape (string, number, random object) without throwing', () => {
    for (const raw of ['garbage', 42, { unrelated: true }, { buster: OUTBOX_BUSTER, entries: 'not-an-array' }]) {
      expect(() => parsePersistedOutbox(raw)).not.toThrow();
      expect(parsePersistedOutbox(raw).droppedStaleShape).toBe(true);
    }
  });

  it('accepts a well-formed envelope with the current buster', () => {
    const env = buildEnvelope([entry('c1', 'pending')]);
    const out = parsePersistedOutbox(env);
    expect(out).toEqual({ entries: [entry('c1', 'pending')], droppedInvalid: 0, droppedStaleShape: false });
  });

  it('drops only the individually-invalid entries, keeping the rest of a valid envelope', () => {
    const corrupt = { ...entry('c2', 'pending'), payload: { ...entry('c2', 'pending').payload, guestId: 'not-a-uuid' } };
    const env = buildEnvelope([entry('c1', 'pending'), corrupt as unknown as OutboxEntry]);
    const out = parsePersistedOutbox(env);
    expect(out.droppedInvalid).toBe(1);
    expect(out.entries).toEqual([entry('c1', 'pending')]);
  });
});

describe('mergeOutboxEntries (O1 cross-tab read-merge, O5 init-race fold-in)', () => {
  it('unions entries present on only one side', () => {
    const mine = [entry('a', 'pending')];
    const other = [entry('b', 'pending')];
    expect(mergeOutboxEntries(mine, other)).toHaveLength(2);
  });

  it('never loses an entry the other side wrote when mine is empty (the O5 mid-await enqueue case in reverse)', () => {
    expect(mergeOutboxEntries([], [entry('a', 'pending')])).toEqual([entry('a', 'pending')]);
  });

  it('never loses an entry mine has when other is stale/empty (the O1 blind-overwrite case)', () => {
    expect(mergeOutboxEntries([entry('a', 'pending')], [])).toEqual([entry('a', 'pending')]);
  });

  it('on a clientId collision, keeps the further-along status rather than reverting it', () => {
    const other = [entry('a', 'syncing')];
    const mine = [entry('a', 'pending')]; // stale local view — hasn't heard about the sibling's progress
    expect(mergeOutboxEntries(mine, other)[0].status).toBe('syncing');

    const other2 = [entry('a', 'pending')];
    const mine2 = [entry('a', 'synced')];
    expect(mergeOutboxEntries(mine2, other2)[0].status).toBe('synced');
  });

  it('breaks a same-status-rank tie by the higher attempt count', () => {
    const other = [entry('a', 'error', 1)];
    const mine = [entry('a', 'error', 3)];
    expect(mergeOutboxEntries(mine, other)[0].attempts).toBe(3);
  });
});
