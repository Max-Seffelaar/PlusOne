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
const getUser = vi.fn(async () => ({ data: { user: { id: 'A' } } }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth: { signOut, getSession, getUser } }),
}));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }));

// The last-chance flush (86ey9et0h) drains through the real replay code, so the
// gateway is the only seam that must not reach the network. Recording the rows
// lets the tests assert what actually went up, not merely that a drain ran.
const gw = vi.hoisted(() => ({ sent: [] as { checked_by?: string; synced_by?: string | null }[], fail: false }));
vi.mock('@/features/door/outbox/gateway', () => {
  const ok = async () => ({ error: null });
  return {
    supabaseGateway: () => ({
      insertCheckIn: async (row: { checked_by?: string; synced_by?: string | null }) => {
        if (gw.fail) return { error: { code: undefined, message: 'Failed to fetch' } };
        gw.sent.push(row);
        return { error: null };
      },
      topUpCheckIn: ok,
      voidCheckIn: ok,
      reviveCheckIn: ok,
      checkOutGuest: ok,
      insertRefusal: ok,
      undoRefusal: ok,
      insertGuest: ok,
      ackNote: ok,
    }),
  };
});

import { idbGet, idbSet, idbClearAll } from '@/features/door/offline/idb';
import { outbox } from '@/features/door/outbox/store';
import { PendingOutboxError, signOutDevice } from './_shared';

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

// Cache Storage half of the wipe (86ey9e9mn). This suite runs in the node env,
// where `caches` is undefined and `clearDeviceCaches()` silently no-ops — so
// without this stub, deleting the whole Cache Storage wipe would still pass
// every test in the repo.
let deletedCaches: string[] = [];
function stubCacheStorage(names: string[]): void {
  deletedCaches = [];
  vi.stubGlobal('caches', {
    keys: async () => names,
    delete: async (name: string) => {
      deletedCaches.push(name);
      return true;
    },
    has: async () => false,
    match: async () => undefined,
    open: async () => ({}),
  });
}

beforeEach(() => {
  signOut.mockReset().mockResolvedValue({ error: null });
  getSession.mockReset().mockResolvedValue({ data: { session: null } }); // no token left = safe to leave
  assign.mockReset();
  vi.spyOn(outbox, 'reset');
  vi.stubGlobal('window', { location: { assign } });
  stubCacheStorage(['plusone-session-v1', 'plusone-shell-v2']);
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

  it('wipes the credentialed Cache Storage bucket, keeping the PII-free shell (86ey9e9mn)', async () => {
    // `/app` HTML in `plusone-session-v1` carries the RSC payload (user id,
    // venue, roles, name, memberships); `plusone-shell-v2` holds only static
    // assets + PII-free door pages and must survive so the next doorhost's own
    // login can still cold-start offline (invariant #25).
    await signOutDevice('local');

    expect(deletedCaches).toEqual(['plusone-session-v1']);
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

    // Ordering revised by the 86ey9e9mn review — this REVERSES the original #233
    // behaviour (which wiped before the session checks). On this path the user
    // stays signed in deliberately, and their token is still on the device
    // either way, so the early wipe protected nothing while destroying a
    // still-working doorhost's un-synced check-ins and offline shell mid-shift.
    it('does NOT redirect when the token cannot be cleared (offline) — throws instead', async () => {
      getSession.mockResolvedValue({ data: { session: A_SESSION } }); // never clears
      await idbSet(OUTBOX_KEY, outboxEntryWithPii);

      await expect(signOutDevice('global')).rejects.toThrow('sign-out-incomplete');

      expect(assign).not.toHaveBeenCalled(); // stayed put — no hand-off of an authed device
    });

    it('keeps this still-signed-in user’s data when sign-out could not complete', async () => {
      getSession.mockResolvedValue({ data: { session: A_SESSION } }); // never clears
      await idbSet(OUTBOX_KEY, outboxEntryWithPii);

      await expect(signOutDevice('global')).rejects.toThrow('sign-out-incomplete');

      // Still their device, still their session — so still their queued check-ins.
      expect(await idbGet(OUTBOX_KEY)).toBeDefined();
      expect(outbox.reset).not.toHaveBeenCalled();
      expect(deletedCaches).toEqual([]);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Sign-out with un-synced door writes (86ey9et0h).
//
// #233 made sign-out wipe the device, which protected the next doorhost's
// privacy by DESTROYING the previous one's queued check-ins. The wipe stays —
// it is still the endpoint — but it no longer gets to happen behind the
// doorhost's back: online we flush first, offline they are told the cost and
// must say so out loud.
// ─────────────────────────────────────────────────────────────────────────────
describe('signOutDevice — un-synced door writes (86ey9et0h)', () => {
  const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const OWNER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

  /** A valid, replayable queued check-in — a guest physically standing inside. */
  function queuedCheckIn(clientId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') {
    return {
      clientId,
      eventId: EVENT_ID,
      kind: 'check_in',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-12T22:00:00.000Z',
      ownerId: OWNER,
      payload: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        guestId: '99999999-9999-4999-8999-999999999999',
        plusOnesArrived: 0,
        clientTimestamp: '2026-08-12T22:00:00.000Z',
      },
    };
  }

  beforeEach(() => {
    gw.sent = [];
    gw.fail = false;
    outbox.reset(); // singleton outlives a test — start each case from empty
  });

  it('flushes the queue before wiping when the device is online', async () => {
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: true });

    await signOutDevice('local');

    expect(gw.sent).toHaveLength(1); // the check-in reached the server FIRST …
    expect(assign).toHaveBeenCalledWith('/login'); // … and only then did we leave
    expect(await idbGet(OUTBOX_KEY)).toBeUndefined();
  });

  it('preserves the queueing doorhost as the actor on that last-chance flush', async () => {
    // The flush runs under whoever is signing out; it must not relabel the rows.
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: true });

    await signOutDevice('local');

    expect(gw.sent[0]).toMatchObject({ checked_by: OWNER, synced_by: 'A' });
  });

  it('refuses to sign out offline while entries are queued, and destroys nothing', async () => {
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: false });

    await expect(signOutDevice('local')).rejects.toBeInstanceOf(PendingOutboxError);

    // Everything the doorhost had is still here: no wipe, no redirect, no signOut.
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(await idbGet(OUTBOX_KEY)).toBeDefined();
  });

  it('reports how many writes are at stake so the prompt can name the cost', async () => {
    await idbSet(OUTBOX_KEY, {
      buster: 'door-outbox-v1',
      entries: [queuedCheckIn('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1'), queuedCheckIn('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2')],
    });
    vi.stubGlobal('navigator', { onLine: false });

    await expect(signOutDevice('local')).rejects.toMatchObject({ pending: 2 });
  });

  it('proceeds and wipes once the doorhost explicitly accepts the loss', async () => {
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: false });

    await signOutDevice('local', { discardPending: true });

    expect(assign).toHaveBeenCalledWith('/login');
    expect(await idbGet(OUTBOX_KEY)).toBeUndefined(); // the wipe is still the endpoint
  });

  it('still refuses when online but the flush cannot get the writes through', async () => {
    // Captive-portal wifi: navigator.onLine lies. The queue is what decides.
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: true });
    gw.fail = true;

    await expect(signOutDevice('local')).rejects.toBeInstanceOf(PendingOutboxError);
    expect(await idbGet(OUTBOX_KEY)).toBeDefined();
  });

  it('signs out normally when nothing is queued', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    await signOutDevice('local');
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
