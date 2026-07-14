import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersistedClient } from '@tanstack/react-query-persist-client';

// The persister writes through ./idb; spy on it so we can assert HOW OFTEN it
// writes without needing a real IndexedDB. `idbEpoch` is controllable so we can
// simulate a sign-out wipe (epoch bump) landing between arming and firing.
vi.mock('./idb', () => ({
  idbSet: vi.fn(() => Promise.resolve()),
  idbGet: vi.fn(() => Promise.resolve(undefined)),
  idbDel: vi.fn(() => Promise.resolve()),
  idbEpoch: vi.fn(() => 0),
}));

import { idbDel, idbEpoch, idbSet } from './idb';
import { createIdbPersister } from './persister';

const THROTTLE = 2000;

function client(tag: string): PersistedClient {
  return { buster: 'b', timestamp: 0, clientState: { tag } } as unknown as PersistedClient;
}

describe('createIdbPersister — throttle (P-IDB2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(idbSet).mockClear();
    vi.mocked(idbDel).mockClear();
    vi.mocked(idbEpoch).mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces a burst of writes into a single trailing IndexedDB write', () => {
    const p = createIdbPersister('k', THROTTLE);
    // A check-in rush: many cache events inside one window.
    p.persistClient(client('a'));
    p.persistClient(client('b'));
    p.persistClient(client('c'));
    expect(idbSet).not.toHaveBeenCalled(); // nothing written yet — trailing edge

    vi.advanceTimersByTime(THROTTLE);
    expect(idbSet).toHaveBeenCalledTimes(1);
    // Only the LAST client is written.
    expect(vi.mocked(idbSet).mock.calls[0][1]).toEqual(client('c'));
  });

  it('writes once per window across successive bursts', () => {
    const p = createIdbPersister('k', THROTTLE);
    p.persistClient(client('a'));
    vi.advanceTimersByTime(THROTTLE);
    p.persistClient(client('b'));
    vi.advanceTimersByTime(THROTTLE);
    expect(idbSet).toHaveBeenCalledTimes(2);
  });

  it('removeClient cancels a queued write so a discarded cache is not resurrected', () => {
    const p = createIdbPersister('k', THROTTLE);
    p.persistClient(client('a'));
    void p.removeClient();
    vi.advanceTimersByTime(THROTTLE * 2);
    expect(idbSet).not.toHaveBeenCalled();
    expect(idbDel).toHaveBeenCalledTimes(1);
  });

  // 86ey9et07 #3: a snapshot write armed before a sign-out wipe must not fire —
  // it would re-create the just-deleted `plusone-door` DB with the previous
  // doorhost's guest snapshot on a shared tablet.
  it('drops a trailing write whose wipe-epoch changed since it was armed', () => {
    const p = createIdbPersister('k', THROTTLE);
    p.persistClient(client('a')); // captured epoch 0
    vi.mocked(idbEpoch).mockReturnValue(1); // idbClearAll() bumped it (sign-out)
    vi.advanceTimersByTime(THROTTLE);
    expect(idbSet).not.toHaveBeenCalled();
  });
});
