// Runs in the default `node` env; `fake-indexeddb/auto` installs a real
// in-memory IndexedDB so we can assert the ACTUAL contents of the `plusone-door`
// store before/after sign-out — not just that a helper was called (86ey9et07).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// signOutDevice only touches Supabase's auth.signOut — stub the client so no real
// supabase-js (or network) is pulled in, and so we can force the failure path.
const signOut = vi.fn(async (_opts: { scope: 'local' | 'global' }) => ({ error: null }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut } }),
}));

import { idbGet, idbSet, idbClearAll } from '@/features/door/offline/idb';
import { signOutDevice } from './_shared';

// The two keys the door persists to the shared `plusone-door` IndexedDB.
const OUTBOX_KEY = 'door-outbox';
const CACHE_KEY = 'door-query-cache';

const assign = vi.fn();

// An outbox entry the way the door queues an on-the-spot add — carries a guest
// name in plaintext, the exact PII a next doorhost must never be able to read.
const outboxEntryWithPii = [
  {
    clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    kind: 'add_guest',
    status: 'pending',
    attempts: 0,
    createdAt: '2026-07-14T22:00:00.000Z',
    payload: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Jane Doe', plusOnes: 0 },
  },
];

beforeEach(() => {
  signOut.mockReset().mockResolvedValue({ error: null });
  assign.mockReset();
  vi.stubGlobal('window', { location: { assign } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await idbClearAll(); // drop the DB so each test starts from a clean origin store
});

describe('signOutDevice — shared-device isolation (86ey9et07)', () => {
  it('empties the door-outbox IndexedDB key on sign-out (no PII left for the next doorhost)', async () => {
    await idbSet(OUTBOX_KEY, outboxEntryWithPii);
    expect(await idbGet(OUTBOX_KEY)).toBeDefined(); // precondition: queue holds A's data

    await signOutDevice('local');

    expect(await idbGet(OUTBOX_KEY)).toBeUndefined();
  });

  it('also wipes the door query-cache snapshot (the full guest list)', async () => {
    await idbSet(CACHE_KEY, { buster: 'b', timestamp: 0, clientState: { guests: ['Jane Doe'] } });

    await signOutDevice('local');

    expect(await idbGet(CACHE_KEY)).toBeUndefined();
  });

  it('signs out with the requested scope and redirects to /login', async () => {
    await signOutDevice('global');

    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('wipes the device even when the network sign-out fails — isolation must not depend on the server round-trip', async () => {
    signOut.mockRejectedValue(new Error('offline'));
    await idbSet(OUTBOX_KEY, outboxEntryWithPii);

    // The rejection re-throws after the `finally`; call sites `void` it. What must
    // still hold is that the local wipe + redirect ran regardless.
    await expect(signOutDevice('local')).rejects.toThrow('offline');

    expect(await idbGet(OUTBOX_KEY)).toBeUndefined();
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
