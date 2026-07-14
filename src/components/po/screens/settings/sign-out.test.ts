// Runs in the default `node` env; `fake-indexeddb/auto` installs a real
// in-memory IndexedDB so we can assert the ACTUAL contents of the `plusone-door`
// store before/after sign-out — not just that a helper was called (86ey9et07).
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// signOutDevice touches auth.signOut + auth.getSession — stub the client so no
// real supabase-js (or network) is pulled in, and so we can drive the
// lingering-session fail-safe (#4).
const signOut = vi.fn(async (_opts: { scope: 'local' | 'global' }) => ({ error: null }));
const getSession = vi.fn(async () => ({ data: { session: null as unknown } }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut, getSession } }),
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

import { idbGet, idbSet, idbClearAll } from '@/features/door/offline/idb';
import { outbox } from '@/features/door/outbox/store';
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

const A_SESSION = { access_token: 'a.token', user: { id: 'A' } };

beforeEach(() => {
  signOut.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: null } }); // no token left = safe to leave
  assign.mockReset();
  vi.spyOn(outbox, 'reset');
  vi.stubGlobal('window', { location: { assign } });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('empties the in-memory outbox singleton too (it outlives a route change)', async () => {
    await signOutDevice('local');

    expect(outbox.reset).toHaveBeenCalledTimes(1);
  });

  it('signs out with the requested scope and redirects to /login', async () => {
    await signOutDevice('global');

    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('still wipes + completes when auth.signOut throws (defensive; it usually returns {error})', async () => {
    signOut.mockRejectedValue(new Error('offline'));
    await idbSet(OUTBOX_KEY, outboxEntryWithPii);

    await signOutDevice('local');

    expect(await idbGet(OUTBOX_KEY)).toBeUndefined();
    expect(outbox.reset).toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/login');
  });

  // #4 — the dangerous case: a failed server revoke leaves A's token on the
  // device. Never navigate to /login while it's there (middleware would bounce
  // the next user to /app AS A).
  describe('lingering-session fail-safe (#4)', () => {
    it('retries a local sign-out when a session is still present, then leaves once it is gone', async () => {
      // getSession: still there after the scoped sign-out, gone after the local retry.
      getSession
        .mockResolvedValueOnce({ data: { session: A_SESSION } })
        .mockResolvedValueOnce({ data: { session: null } });

      await signOutDevice('global');

      expect(signOut).toHaveBeenNthCalledWith(1, { scope: 'global' });
      expect(signOut).toHaveBeenNthCalledWith(2, { scope: 'local' }); // the retry
      expect(assign).toHaveBeenCalledWith('/login');
    });

    it('does NOT redirect when the token cannot be cleared (offline) — throws instead', async () => {
      getSession.mockResolvedValue({ data: { session: A_SESSION } }); // never clears
      await idbSet(OUTBOX_KEY, outboxEntryWithPii);

      await expect(signOutDevice('global')).rejects.toThrow('sign-out-incomplete');

      expect(assign).not.toHaveBeenCalled(); // stayed put — no hand-off of an authed device
      expect(await idbGet(OUTBOX_KEY)).toBeUndefined(); // PII still wiped (network-independent)
      expect(outbox.reset).toHaveBeenCalled();
    });
  });
});
