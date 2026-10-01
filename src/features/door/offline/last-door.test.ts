/**
 * The last pinned door event (N7, decision 15) — real in-memory IndexedDB via
 * `fake-indexeddb/auto`, so the wipe assertions exercise the actual
 * `deleteDatabase` path sign-out uses.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idbClearAll, idbEpoch, idbSet } from './idb';
import { loadLastDoorEvent, offlineDoorPin, saveLastDoorEvent, type LastDoorEvent } from './last-door';

vi.mock('@/lib/observability/sentry-client', () => ({ captureMessage: vi.fn() }));

const PIN: LastDoorEvent = { userId: 'u1', venueId: 'v1', eventId: 'ev-1', name: 'Friday' };

describe('last door event — storage', () => {
  beforeEach(async () => {
    await idbClearAll();
  });

  it('round-trips through the door IndexedDB store', async () => {
    expect(await loadLastDoorEvent()).toBeNull();
    expect(await saveLastDoorEvent(PIN)).toBe(true);
    expect(await loadLastDoorEvent()).toEqual(PIN);
  });

  it('is gone after the sign-out wipe (idbClearAll) — a signed-out device has no door to boot', async () => {
    await saveLastDoorEvent(PIN);
    await idbClearAll();
    expect(await loadLastDoorEvent()).toBeNull();
  });

  it('drops a write scheduled before a sign-out wipe (epoch guard)', async () => {
    const scheduledAt = idbEpoch();
    await idbClearAll();
    expect(await saveLastDoorEvent(PIN, scheduledAt)).toBe(false);
    expect(await loadLastDoorEvent()).toBeNull();
  });

  it('never trusts a malformed value read back from disk', async () => {
    await idbSet('door-last-event', { venueId: 'v1', eventId: 42 });
    expect(await loadLastDoorEvent()).toBeNull();
    await idbSet('door-last-event', 'ev-1');
    expect(await loadLastDoorEvent()).toBeNull();
    // A pin without its owner (written before the user-id stamp) is no pin.
    await idbSet('door-last-event', { venueId: 'v1', eventId: 'ev-1', name: 'Friday' });
    expect(await loadLastDoorEvent()).toBeNull();
  });

  it('refuses to store an incomplete pin', async () => {
    expect(await saveLastDoorEvent({ userId: 'u1', venueId: '', eventId: 'ev-1', name: 'x' })).toBe(false);
    expect(await loadLastDoorEvent()).toBeNull();
  });
});

describe('offlineDoorPin — the pin never overrides a loaded list', () => {
  const base = {
    pin: PIN,
    userId: 'u1',
    venueId: 'v1',
    requestedEventId: null,
    candidatesLoaded: false,
    candidatesUnreachable: true,
  };

  it('mounts the pin while the candidate list is unreachable', () => {
    expect(offlineDoorPin(base)).toEqual(PIN);
  });

  it('never applies once the candidate list has loaded — even an empty one', () => {
    expect(offlineDoorPin({ ...base, candidatesLoaded: true })).toBeNull();
    expect(offlineDoorPin({ ...base, candidatesLoaded: true, candidatesUnreachable: false })).toBeNull();
  });

  it('does not apply while the list is merely loading (online)', () => {
    expect(offlineDoorPin({ ...base, candidatesUnreachable: false })).toBeNull();
  });

  it('only for the active venue', () => {
    expect(offlineDoorPin({ ...base, venueId: 'v2' })).toBeNull();
    expect(offlineDoorPin({ ...base, venueId: null })).toBeNull();
  });

  it('only for the user who worked the door (a session that ended without sign-out)', () => {
    expect(offlineDoorPin({ ...base, userId: 'u2' })).toBeNull();
    expect(offlineDoorPin({ ...base, userId: null })).toBeNull();
  });

  it('never against an explicit ?event= for another event', () => {
    expect(offlineDoorPin({ ...base, requestedEventId: 'ev-other' })).toBeNull();
    expect(offlineDoorPin({ ...base, requestedEventId: 'ev-1' })).toEqual(PIN);
  });

  it('nothing to mount without a pin', () => {
    expect(offlineDoorPin({ ...base, pin: null })).toBeNull();
  });
});
