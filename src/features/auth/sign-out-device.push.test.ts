/**
 * signOutDevice × push (Fase 17 N5). The order is the contract:
 *   outbox gate → push rows deleted + FCM token invalidated (session still alive,
 *   owner-only RLS needs it) → auth.signOut → session confirmed gone → wipe.
 * Every step writes to one log so the tests assert the sequence, not just calls.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const log = vi.hoisted(() => [] as string[]);
const state = vi.hoisted(() => ({ signedIn: true, signOutFails: false }));

const fake = vi.hoisted(() => ({
  supported: true,
  perm: 'granted',
  unregister: vi.fn(async () => {
    log.push('fcm-unregister');
  }),
  register: vi.fn(async () => {
    log.push('fcm-register');
    return { token: 'fcm-new', transport: 'fcm' };
  }),
}));
vi.mock('@/features/notifications/provider', () => ({
  getNotificationProvider: () => ({
    isSupported: () => fake.supported,
    checkPermission: async () => fake.perm,
    requestPermission: async () => fake.perm,
    register: fake.register,
    unregister: fake.unregister,
  }),
}));

const SID = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
const ACCESS = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ session_id: SID })).toString('base64url')}.s`;

vi.mock('@/lib/supabase/client', () => {
  const from = (table: string) => {
    const filters: string[] = [];
    const b = {
      delete: () => b,
      eq: (c: string, v: string) => {
        filters.push(`${c}=${v}`);
        return b;
      },
      upsert: async (row: { token: string }) => {
        log.push(`upsert ${table} ${row.token}`);
        return { error: null };
      },
      then: (res: (v: unknown) => unknown) => {
        log.push(`delete ${table} ${filters.join('&')}${state.signedIn ? '' : ' (NO SESSION)'}`);
        return Promise.resolve({ error: null }).then(res);
      },
    };
    return b;
  };
  return {
    createClient: () => ({
      from,
      auth: {
        getUser: async () => ({ data: { user: { id: 'A' } } }),
        getSession: async () => ({ data: { session: state.signedIn ? { access_token: ACCESS } : null } }),
        signOut: async ({ scope }: { scope: string }) => {
          log.push(`signOut:${scope}`);
          if (!state.signOutFails) state.signedIn = false;
          return { error: null };
        },
      },
    }),
  };
});

vi.mock('@/features/door/offline/idb', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/features/door/offline/idb')>();
  return {
    ...real,
    idbClearAll: async () => {
      log.push('wipe');
      await real.idbClearAll();
    },
  };
});

import { idbSet } from '@/features/door/offline/idb';
import { outbox } from '@/features/door/outbox/store';
import { PendingOutboxError, signOutDevice } from './sign-out-device';

const assign = vi.fn();
const prefs = new Map<string, string>();

beforeEach(() => {
  log.length = 0;
  state.signedIn = true;
  state.signOutFails = false;
  fake.supported = true;
  fake.perm = 'granted';
  prefs.clear();
  vi.stubGlobal('window', {
    location: { assign },
    localStorage: {
      getItem: (k: string) => prefs.get(k) ?? null,
      setItem: (k: string, v: string) => void prefs.set(k, v),
      removeItem: (k: string) => void prefs.delete(k),
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('signOutDevice — push unregister ordering (N5)', () => {
  it('deletes this session\'s push rows and the FCM token BEFORE the session ends and BEFORE the wipe', async () => {
    await signOutDevice('local');
    expect(log).toEqual([`delete push_tokens session_id=${SID}`, 'fcm-unregister', 'signOut:local', 'wipe']);
    expect(assign).toHaveBeenCalledWith('/login');
  });

  it('clears the device push prefs with the wipe (next person on a shared device starts clean)', async () => {
    prefs.set('po:push-off', '1');
    prefs.set('po:push-ask-snooze', '9999999999999');
    await signOutDevice('local');
    expect(prefs.size).toBe(0);
  });

  it('a web build sends no push delete at all', async () => {
    fake.supported = false;
    await signOutDevice('global');
    expect(log).toEqual(['signOut:global', 'wipe']);
  });

  it('a refused sign-out (unsent door writes, offline) touches nothing, push included', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    outbox.reset(); // the singleton outlives a test
    await idbSet('door-outbox', {
      buster: 'door-outbox-v1',
      entries: [
        {
          clientId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          kind: 'check_in',
          status: 'pending',
          attempts: 0,
          createdAt: '2026-09-25T22:00:00.000Z',
          ownerId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          payload: {
            id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
            guestId: '99999999-9999-4999-8999-999999999999',
            plusOnesArrived: 0,
            clientTimestamp: '2026-09-25T22:00:00.000Z',
          },
        },
      ],
    });
    await expect(signOutDevice('local')).rejects.toBeInstanceOf(PendingOutboxError);
    expect(log).toEqual([]);
    log.length = 0;
    await signOutDevice('local', { discardPending: true }); // the explicit "discard" answer
    expect(log[0]).toBe(`delete push_tokens session_id=${SID}`);
  });

  it('sign-out-incomplete (session survives) re-registers push so the user is not left deaf', async () => {
    state.signOutFails = true;
    await expect(signOutDevice('local')).rejects.toThrow('sign-out-incomplete');
    await new Promise((r) => setTimeout(r, 0));
    expect(log.slice(0, 2)).toEqual([`delete push_tokens session_id=${SID}`, 'fcm-unregister']);
    expect(log).not.toContain('wipe');
    expect(log).toContain('fcm-register');
    expect(log).toContain('upsert push_tokens fcm-new');
  });
});
