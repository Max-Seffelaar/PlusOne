import { describe, expect, it } from 'vitest';
import { hasUnsynced, isPending, isRetryable, type OutboxEntry, type OutboxStatus } from './types';

/** A check-in entry with a given status (the kind is irrelevant to the predicates). */
function entry(status: OutboxStatus): OutboxEntry {
  return {
    clientId: `c-${status}`,
    eventId: 'ev1',
    kind: 'check_in',
    status,
    attempts: 0,
    createdAt: '2026-06-20T22:00:00.000Z',
    payload: { id: 'ci1', guestId: 'g1', plusOnesArrived: 0, clientTimestamp: 't' },
  };
}

describe('isPending (auto-drainer set)', () => {
  it('is true only for pending entries', () => {
    expect(isPending(entry('pending'))).toBe(true);
    for (const s of ['syncing', 'synced', 'duplicate', 'error'] as const) {
      expect(isPending(entry(s))).toBe(false);
    }
  });
});

describe('isRetryable (manual force-sync set)', () => {
  it('retries pending and terminal errors, but never a settled/in-flight entry', () => {
    expect(isRetryable(entry('pending'))).toBe(true);
    expect(isRetryable(entry('error'))).toBe(true);
    // A quota/tier rejection (error) can be retried after the admin grants slots.
    for (const s of ['syncing', 'synced', 'duplicate'] as const) {
      expect(isRetryable(entry(s))).toBe(false);
    }
  });
});

describe('hasUnsynced (sync-bar dot)', () => {
  it('is false when every entry has settled', () => {
    expect(hasUnsynced([])).toBe(false);
    expect(hasUnsynced([entry('synced'), entry('duplicate'), entry('error')])).toBe(false);
  });

  it('is true while anything still needs the network (pending or syncing)', () => {
    expect(hasUnsynced([entry('synced'), entry('pending')])).toBe(true);
    expect(hasUnsynced([entry('syncing')])).toBe(true);
  });

  it('treats a terminal error as settled, not unsynced (it needs a manual retry)', () => {
    // An error doesn't keep the auto-sync dot lit — it surfaces its own message.
    expect(hasUnsynced([entry('error')])).toBe(false);
  });
});
