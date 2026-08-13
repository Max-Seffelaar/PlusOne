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

  it('salvages a legacy bare-array shape (pre-envelope persistence) instead of wiping the queue', () => {
    // A doorhost offline with unsynced entries at the exact moment the new
    // bundle activates must not silently lose them (review 2026-07-14) — the
    // whole point of this PR is not losing queued work.
    const out = parsePersistedOutbox([entry('c1', 'pending')]);
    expect(out).toEqual({ entries: [entry('c1', 'pending')], droppedInvalid: 0, droppedStaleShape: false });
  });

  it('salvages the valid elements of a legacy bare array and quarantines the rest individually', () => {
    const corrupt = { ...entry('c2', 'pending'), payload: { ...entry('c2', 'pending').payload, guestId: 'not-a-uuid' } };
    const out = parsePersistedOutbox([entry('c1', 'pending'), corrupt as unknown as OutboxEntry]);
    expect(out).toEqual({ entries: [entry('c1', 'pending')], droppedInvalid: 1, droppedStaleShape: false });
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

// ─────────────────────────────────────────────────────────────────────────────
// Owner stamp round-trip (86ey9et0h). The whole feature rests on ownerId
// surviving IndexedDB: if it were dropped on load, a hand-off would silently
// fall back to drain-time attribution — exactly the bug being fixed.
// ─────────────────────────────────────────────────────────────────────────────
describe('parsePersistedOutbox — ownerId (86ey9et0h)', () => {
  const OWNER = '44444444-4444-4444-8444-444444444444';

  it('round-trips ownerId through buildEnvelope → parse', () => {
    const withOwner = { ...entry('c1', 'pending'), ownerId: OWNER };
    const parsed = parsePersistedOutbox(buildEnvelope([withOwner]));
    expect(parsed.entries[0].ownerId).toBe(OWNER);
    expect(parsed.droppedInvalid).toBe(0);
  });

  it('keeps an entry written by a pre-owner-stamp bundle instead of quarantining it', () => {
    // Load-bearing back-compat: OUTBOX_BUSTER is intentionally NOT bumped, so
    // these entries are still on real devices. Dropping them for a missing
    // field would destroy queued check-ins — the exact harm this PR prevents.
    const parsed = parsePersistedOutbox(buildEnvelope([entry('c1', 'pending')]));
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].ownerId).toBeUndefined();
    expect(parsed.droppedInvalid).toBe(0);
  });

  it('normalises a persisted null ownerId to undefined rather than dropping the entry', () => {
    const parsed = parsePersistedOutbox({
      buster: OUTBOX_BUSTER,
      entries: [{ ...entry('c1', 'pending'), ownerId: null }],
    });
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].ownerId).toBeUndefined();
  });

  it('quarantines a non-uuid ownerId (a corrupt stamp must not become a forged actor)', () => {
    const parsed = parsePersistedOutbox({
      buster: OUTBOX_BUSTER,
      entries: [{ ...entry('c1', 'pending'), ownerId: 'not-a-uuid' }],
    });
    expect(parsed.entries).toHaveLength(0);
    expect(parsed.droppedInvalid).toBe(1);
  });

  it('preserves ownerId across a cross-tab merge', () => {
    const mine = { ...entry('c1', 'pending'), ownerId: OWNER };
    expect(mergeOutboxEntries([mine], [])[0].ownerId).toBe(OWNER);
    expect(mergeOutboxEntries([], [mine])[0].ownerId).toBe(OWNER);
  });
});
