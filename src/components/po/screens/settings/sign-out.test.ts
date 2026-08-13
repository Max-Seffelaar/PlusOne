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
const gw = vi.hoisted(() => ({
  sent: [] as { checked_by?: string; synced_by?: string | null }[],
  /** Code-LESS failure = network/offline: the entry stays `pending`. */
  fail: false,
  /** Coded TERMINAL rejection (quota/tier/capacity): the entry dead-letters to
   *  `error`. The distinction matters — only the first kind should block a
   *  sign-out, and conflating them is what trapped the doorhost (C3). */
  terminal: false,
}));
vi.mock('@/features/door/outbox/gateway', () => {
  const ok = async () => ({ error: null });
  return {
    supabaseGateway: () => ({
      insertCheckIn: async (row: { checked_by?: string; synced_by?: string | null }) => {
        if (gw.terminal) return { error: { code: '45005', message: 'This event is at capacity.' } };
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
    gw.terminal = false;
    outbox.reset(); // singleton outlives a test — start each case from empty
  });

  it('flushes the queue before wiping when the device is online', async () => {
    // The signing-out user owns this entry, so it is theirs to send.
    getUser.mockResolvedValue({ data: { user: { id: OWNER } } });
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: true });

    await signOutDevice('local');

    expect(gw.sent).toHaveLength(1); // the check-in reached the server FIRST …
    expect(assign).toHaveBeenCalledWith('/login'); // … and only then did we leave
    expect(await idbGet(OUTBOX_KEY)).toBeUndefined();
  });

  it('keeps the queueing doorhost as the actor, and omits synced_by on their own queue', async () => {
    // Same session tapped and sent it, so there is no hand-off to record — and
    // the key must be ABSENT, not null: PostgREST derives the column list from
    // the JSON keys, so naming a column the deployed schema may not have yet
    // would reject every door write until the migration lands.
    getUser.mockResolvedValue({ data: { user: { id: OWNER } } });
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [queuedCheckIn()] });
    vi.stubGlobal('navigator', { onLine: true });

    await signOutDevice('local');

    expect(gw.sent[0]).toMatchObject({ checked_by: OWNER });
    expect(gw.sent[0]).not.toHaveProperty('synced_by');
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

// ─────────────────────────────────────────────────────────────────────────────
// Regressions from the review of this PR (86ey9et0h). Each of these passed
// silently before the fix, which is the point: the flush's failure modes all
// look like success from the outside.
// ─────────────────────────────────────────────────────────────────────────────
describe('signOutDevice — flush failure modes (86ey9et0h review)', () => {
  const EVENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  /** Valid UUIDs on purpose: the persisted-entry schema quarantines anything
   *  else, which would silently empty the queue and make these tests vacuous. */
  const ME = '11111111-2222-4333-8444-555555555555';
  const SOMEONE_ELSE = '99999999-8888-4777-8666-555555555555';

  function entry(over: Record<string, unknown> = {}) {
    return {
      clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      eventId: EVENT_ID,
      kind: 'check_in',
      status: 'pending',
      attempts: 0,
      createdAt: '2026-08-12T22:00:00.000Z',
      ownerId: ME,
      payload: {
        id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        guestId: '99999999-9999-4999-8999-999999999999',
        plusOnesArrived: 0,
        clientTimestamp: '2026-08-12T22:00:00.000Z',
      },
      ...over,
    };
  }

  beforeEach(() => {
    gw.sent = [];
    gw.fail = false;
    gw.terminal = false;
    outbox.reset();
    vi.stubGlobal('navigator', { onLine: true });
  });

  it('does not let a dead-lettered entry block sign-out forever', async () => {
    // A 45005 capacity rejection is terminal: retrying it changes nothing, and
    // it lives 12h as a tombstone. Counting it as "not yet synced" trapped the
    // doorhost behind a destructive-only prompt for the rest of the night.
    getUser.mockResolvedValue({ data: { user: { id: ME } } });
    gw.terminal = true; // the retry is rejected again, exactly as the real 45005 would be
    await idbSet(OUTBOX_KEY, {
      buster: 'door-outbox-v1',
      entries: [entry({ status: 'error', message: 'This event is at capacity.' })],
    });

    await signOutDevice('local');

    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('surfaces the count when getUser() rejects on a lying-online connection', async () => {
    // Captive-portal wifi: navigator.onLine is true, the auth round-trip fails.
    // An escaping throw showed a generic "could not sign out" and the doorhost
    // never saw the choice — in the exact scenario the prompt exists for.
    getUser.mockRejectedValue(new TypeError('Failed to fetch'));
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [entry()] });

    await expect(signOutDevice('local')).rejects.toBeInstanceOf(PendingOutboxError);
    expect(await idbGet(OUTBOX_KEY)).toBeDefined();
  });

  it('leaves a previous doorhost\'s queue untouched when someone else signs out', async () => {
    // A staff/finance session cannot pass can_check_in, so replaying A's entries
    // returns 42501 — terminal — and would flip them to `error`. Automatic drains
    // never retry those, so A's check-ins would be silently unrecoverable: the
    // feature destroying the queue it exists to protect.
    getUser.mockResolvedValue({ data: { user: { id: SOMEONE_ELSE } } });
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [entry({ ownerId: ME })] });

    await expect(signOutDevice('local')).rejects.toBeInstanceOf(PendingOutboxError);

    expect(gw.sent).toHaveLength(0); // never attempted under the wrong session
    const stored = (await idbGet(OUTBOX_KEY)) as { entries: { status: string }[] };
    expect(stored.entries[0].status).toBe('pending'); // still replayable by its owner
  });

  it('still drains an unattributed (pre-owner-stamp) entry rather than stranding it', async () => {
    getUser.mockResolvedValue({ data: { user: { id: SOMEONE_ELSE } } });
    await idbSet(OUTBOX_KEY, { buster: 'door-outbox-v1', entries: [entry({ ownerId: undefined })] });

    await signOutDevice('local');

    expect(gw.sent).toHaveLength(1);
    expect(assign).toHaveBeenCalledWith('/login');
  });
});
