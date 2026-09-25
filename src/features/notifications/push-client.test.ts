/**
 * Push lifecycle (Fase 17 N5): the push_tokens body shape, denial handling, the
 * Profile off switch and the bounded sign-out step. The provider is faked; the
 * Supabase client is a recording stub so the tests assert what would actually
 * be sent to PostgREST.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({
  supported: true,
  perm: 'default' as string,
  requestResult: 'granted' as string,
  token: 'fcm-token-1' as string | null,
  register: vi.fn(),
  unregister: vi.fn(async () => undefined),
  requestPermission: vi.fn(),
}));
vi.mock('./provider', () => ({
  getNotificationProvider: () => ({
    isSupported: () => fake.supported,
    checkPermission: async () => fake.perm,
    requestPermission: fake.requestPermission,
    register: fake.register,
    unregister: fake.unregister,
  }),
}));

import {
  PROMPT_SNOOZE_MS,
  SIGN_OUT_PUSH_TIMEOUT_MS,
  clearPushPrefs,
  deleteThisDevicePushTokens,
  disablePush,
  enablePush,
  isPushOptedOut,
  isPushPromptSnoozed,
  pushTokenRow,
  resumePush,
  savePushToken,
  sessionIdFromAccessToken,
  snoozePushPrompt,
  unregisterPushForSignOut,
} from './push-client';

const SID = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f70';
function jwt(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.sig`;
}

type Call = { op: 'upsert'; table: string; row: Record<string, unknown>; opts: unknown } | { op: 'delete'; table: string; filters: string[] };

function client(opts: { hang?: boolean; session?: boolean } = {}) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const filters: string[] = [];
    const b = {
      upsert: (row: Record<string, unknown>, o: unknown) => {
        calls.push({ op: 'upsert', table, row, opts: o });
        return Promise.resolve({ error: null });
      },
      delete: () => b,
      eq: (c: string, v: string) => {
        filters.push(`${c}=${v}`);
        return b;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push({ op: 'delete', table, filters });
        const p = opts.hang ? new Promise(() => {}) : Promise.resolve({ error: null });
        return p.then(res, rej);
      },
    };
    return b;
  };
  const supabase = {
    from,
    auth: {
      getSession: async () => ({
        data: { session: opts.session === false ? null : { access_token: jwt({ sub: 'u1', session_id: SID }) } },
      }),
    },
  };
  return { supabase: supabase as never, calls };
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  fake.supported = true;
  fake.perm = 'default';
  fake.requestResult = 'granted';
  fake.token = 'fcm-token-1';
  fake.register.mockReset().mockImplementation(async () => (fake.token ? { token: fake.token, transport: 'fcm' } : null));
  fake.unregister.mockClear();
  fake.requestPermission.mockReset().mockImplementation(async () => fake.requestResult);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('push_tokens upsert shape', () => {
  it('sends transport/token/label/last_seen_at only — never user_id or session_id (N2 stamps them)', () => {
    const row = pushTokenRow({ token: 't', transport: 'fcm' }, new Date('2026-09-25T10:00:00Z'));
    expect(Object.keys(row).sort()).toEqual(['device_label', 'last_seen_at', 'token', 'transport']);
    expect(row).toEqual({ transport: 'fcm', token: 't', device_label: 'android', last_seen_at: '2026-09-25T10:00:00.000Z' });
  });

  it('upserts on (transport, token) through the given (user-scoped) client', async () => {
    const { supabase, calls } = client();
    await expect(savePushToken(supabase, { token: 'abc', transport: 'fcm' })).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c).toMatchObject({ op: 'upsert', table: 'push_tokens', opts: { onConflict: 'transport,token' } });
    if (c.op !== 'upsert') throw new Error('unreachable');
    expect(c.row).not.toHaveProperty('user_id');
    expect(c.row).not.toHaveProperty('session_id');
    expect(c.row).toMatchObject({ transport: 'fcm', token: 'abc' });
  });

  it('a token refresh is simply another upsert of the new token', async () => {
    const { supabase, calls } = client();
    await savePushToken(supabase, { token: 'old', transport: 'fcm' });
    await savePushToken(supabase, { token: 'new', transport: 'fcm' });
    expect(calls.map((c) => (c.op === 'upsert' ? c.row.token : null))).toEqual(['old', 'new']);
  });
});

describe('sessionIdFromAccessToken', () => {
  it('reads the session_id claim', () => {
    expect(sessionIdFromAccessToken(jwt({ session_id: SID }))).toBe(SID);
  });
  it.each(['', 'not-a-jwt', 'a.%%%.c', jwt({ sub: 'x' }), jwt({ session_id: 42 })])('returns null for %s', (t) => {
    expect(sessionIdFromAccessToken(t)).toBeNull();
  });
});

describe('enable / resume / denial', () => {
  it('denied at the OS prompt → nothing registered, nothing stored', async () => {
    fake.requestResult = 'denied';
    const { supabase, calls } = client();
    await expect(enablePush(supabase)).resolves.toBe('denied');
    expect(fake.register).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('granted → registers, stores the token, clears a previous opt-out', async () => {
    store.set('po:push-off', '1');
    const { supabase, calls } = client();
    await expect(enablePush(supabase)).resolves.toBe('granted');
    expect(calls).toHaveLength(1);
    expect(isPushOptedOut()).toBe(false);
  });

  it('resume on app start registers only with permission and without an opt-out', async () => {
    const run = async () => {
      const { supabase, calls } = client();
      await resumePush(supabase);
      return calls.length;
    };
    fake.perm = 'default';
    expect(await run()).toBe(0);
    fake.perm = 'denied';
    expect(await run()).toBe(0);
    fake.perm = 'granted';
    expect(await run()).toBe(1);
    store.set('po:push-off', '1');
    expect(await run()).toBe(0);
  });

  it('resume never prompts', async () => {
    fake.perm = 'default';
    await resumePush(client().supabase);
    expect(fake.requestPermission).not.toHaveBeenCalled();
  });

  it('a web build (unsupported) does nothing', async () => {
    fake.supported = false;
    const { supabase, calls } = client();
    await expect(resumePush(supabase)).resolves.toBe('unsupported');
    await unregisterPushForSignOut(supabase);
    expect(calls).toEqual([]);
    expect(fake.unregister).not.toHaveBeenCalled();
  });

  it('snooze keeps the ask away for 14 days; sign-out clears the prefs', () => {
    const now = 1_000_000;
    expect(isPushPromptSnoozed(now)).toBe(false);
    snoozePushPrompt(now);
    expect(isPushPromptSnoozed(now + PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(isPushPromptSnoozed(now + PROMPT_SNOOZE_MS + 1)).toBe(false);
    store.set('po:push-off', '1');
    clearPushPrefs();
    expect(store.size).toBe(0);
  });
});

describe('turning push off / removing this device', () => {
  it('disablePush remembers the choice, deletes this session\'s + this token\'s rows, invalidates the FCM token', async () => {
    const { supabase, calls } = client();
    await savePushToken(supabase, { token: 'mine', transport: 'fcm' });
    await disablePush(supabase);
    expect(isPushOptedOut()).toBe(true);
    const deletes = calls.filter((c) => c.op === 'delete');
    expect(deletes).toEqual([
      { op: 'delete', table: 'push_tokens', filters: [`session_id=${SID}`] },
      { op: 'delete', table: 'push_tokens', filters: ['transport=fcm', 'token=mine'] },
    ]);
    expect(fake.unregister).toHaveBeenCalledTimes(1);
  });

  it('without a session or a known token there is nothing to delete by', async () => {
    const { supabase, calls } = client({ session: false });
    await deleteThisDevicePushTokens(supabase);
    expect(calls).toEqual([]);
  });

  it('sign-out step never hangs: a stuck delete is abandoned after the timeout', async () => {
    vi.useFakeTimers();
    const { supabase } = client({ hang: true });
    let done = false;
    void unregisterPushForSignOut(supabase).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(SIGN_OUT_PUSH_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });

  it('sign-out step still invalidates the FCM token when the row delete fails', async () => {
    const { supabase } = client();
    (supabase as { auth: { getSession: () => Promise<unknown> } }).auth.getSession = async () => {
      throw new Error('offline');
    };
    await unregisterPushForSignOut(supabase);
    expect(fake.unregister).toHaveBeenCalledTimes(1);
  });
});
