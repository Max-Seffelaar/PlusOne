/**
 * Push lifecycle (Fase 17 N5): the push_tokens body shape, denial handling, the
 * Profile off switch and the bounded sign-out step. The provider is faked; the
 * Supabase client is a recording stub so the tests assert what would actually
 * be sent to PostgREST — including that the FCM token never lands in a URL.
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
  __resetPushClientForTests,
  SIGN_OUT_PUSH_TIMEOUT_MS,
  clearPushPrefs,
  deleteThisDevicePushTokens,
  disablePush,
  enablePush,
  invalidatePushTransportForSignOut,
  isPushOnHere,
  isPushOptedOut,
  isPushUndecided,
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

type Call =
  | { op: 'upsert'; table: string; row: Record<string, unknown>; opts: unknown }
  | { op: 'delete'; table: string; filters: string[] };

const ROW_ID = '0190f0b2-7c1a-7cc3-9a61-2b3c4d5e6f99';

/** A recording PostgREST stub. `hang`: deletes never answer (but honour an abort
 *  signal, like fetch). `fail`: deletes answer `{ error }`, as PostgREST does
 *  offline/on a 5xx — never a throw. `late`: deletes wait for `release()`. */
function client(opts: { hang?: boolean; fail?: boolean; late?: boolean; session?: boolean } = {}) {
  const calls: Call[] = [];
  const pending: (() => void)[] = [];
  const from = (table: string) => {
    const filters: string[] = [];
    let signal: AbortSignal | undefined;
    const b = {
      upsert: (row: Record<string, unknown>, o: unknown) => {
        calls.push({ op: 'upsert', table, row, opts: o });
        const res = Promise.resolve({ data: { id: ROW_ID }, error: null });
        return { select: () => ({ single: () => res }) };
      },
      delete: () => b,
      abortSignal: (s: AbortSignal) => {
        signal = s;
        return b;
      },
      eq: (c: string, v: string) => {
        filters.push(`${c}=${v}`);
        return b;
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        calls.push({ op: 'delete', table, filters });
        let p: Promise<unknown>;
        if (opts.hang || opts.late) {
          p = new Promise((resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
            if (opts.late) pending.push(() => resolve({ error: null }));
          });
        } else {
          p = Promise.resolve(opts.fail ? { error: { message: 'fetch failed' } } : { error: null });
        }
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
  return { supabase: supabase as never, calls, release: () => pending.splice(0).forEach((f) => f()) };
}

const reg = (token: string) => ({ token, transport: 'fcm' as const, platform: 'android' as const });

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  __resetPushClientForTests();
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
  fake.register.mockReset().mockImplementation(async () => (fake.token ? reg(fake.token) : null));
  fake.unregister.mockClear();
  fake.requestPermission.mockReset().mockImplementation(async () => fake.requestResult);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('push_tokens upsert shape', () => {
  it('sends transport/token/label only — never user_id, session_id or last_seen_at (the stamp trigger owns them)', () => {
    const row = pushTokenRow(reg('t'));
    expect(row).toEqual({ transport: 'fcm', token: 't', device_label: 'android' });
    expect(pushTokenRow({ token: 't', transport: 'fcm', platform: 'ios' }).device_label).toBe('ios');
  });

  it('upserts on (transport, token) through the given (user-scoped) client and remembers the row id', async () => {
    store.set('po:push', 'on');
    const { supabase, calls } = client();
    await expect(savePushToken(supabase, reg('abc'))).resolves.toBe(true);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c).toMatchObject({ op: 'upsert', table: 'push_tokens', opts: { onConflict: 'transport,token' } });
    if (c.op !== 'upsert') throw new Error('unreachable');
    expect(Object.keys(c.row).sort()).toEqual(['device_label', 'token', 'transport']);
    expect(store.get('po:push-row')).toBe(ROW_ID); // a uuid: PII-free
  });

  it('a token refresh is simply another upsert of the new token', async () => {
    store.set('po:push', 'on');
    const { supabase, calls } = client();
    await savePushToken(supabase, reg('old'));
    await savePushToken(supabase, reg('new'));
    expect(calls.map((c) => (c.op === 'upsert' ? c.row.token : null))).toEqual(['old', 'new']);
  });

  it('the same registration event reaching two listeners is stored once', async () => {
    store.set('po:push', 'on');
    const { supabase, calls } = client();
    const [a, b] = await Promise.all([savePushToken(supabase, reg('same')), savePushToken(supabase, reg('same'))]);
    await savePushToken(supabase, reg('same'));
    expect([a, b]).toEqual([true, true]);
    expect(calls.filter((c) => c.op === 'upsert')).toHaveLength(1);
  });

  it('stores nothing unless push is on here (a late token after "off" cannot recreate the row)', async () => {
    const { supabase, calls } = client();
    await expect(savePushToken(supabase, reg('late'))).resolves.toBe(false);
    for (const state of ['off', 'off-pending', 'declined']) {
      store.set('po:push', state);
      await expect(savePushToken(supabase, reg('late'))).resolves.toBe(false);
    }
    expect(calls).toEqual([]);
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
  it('denied at the OS prompt → nothing registered, nothing stored, and the refusal is remembered', async () => {
    fake.requestResult = 'denied';
    const { supabase, calls } = client();
    await expect(enablePush(supabase)).resolves.toBe('denied');
    expect(fake.register).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(isPushUndecided()).toBe(false);
  });

  it('a first denial on Android 13+ (prompt-with-rationale → default) is remembered too: the card stays away', async () => {
    fake.requestResult = 'default';
    await enablePush(client().supabase);
    expect(isPushUndecided()).toBe(false);
    expect(isPushOnHere()).toBe(false);
  });

  it('granted → registers, stores the token, clears a previous opt-out', async () => {
    store.set('po:push', 'off');
    const { supabase, calls } = client();
    await expect(enablePush(supabase)).resolves.toBe('granted');
    expect(calls).toHaveLength(1);
    expect(isPushOptedOut()).toBe(false);
    expect(isPushOnHere()).toBe(true);
  });

  it('resume on app start registers only when turned on here, with permission, and not opted out', async () => {
    const run = async () => {
      const { supabase, calls } = client();
      await resumePush(supabase);
      return calls.filter((c) => c.op === 'upsert').length;
    };
    store.set('po:push', 'on');
    fake.perm = 'default';
    expect(await run()).toBe(0);
    fake.perm = 'denied';
    expect(await run()).toBe(0);
    fake.perm = 'granted';
    expect(await run()).toBe(1);
    store.set('po:push', 'off');
    expect(await run()).toBe(0);
  });

  it('an OS grant alone never registers (Android ≤12 grants from install): the card is the consent step', async () => {
    fake.perm = 'granted';
    const { supabase, calls } = client();
    await expect(resumePush(supabase)).resolves.toBe('granted');
    expect(fake.register).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(isPushUndecided()).toBe(true);
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
    await invalidatePushTransportForSignOut();
    expect(calls).toEqual([]);
    expect(fake.unregister).not.toHaveBeenCalled();
  });

  it('snooze keeps the ask away for 14 days; sign-out clears every po:push key', () => {
    const now = 1_000_000;
    expect(isPushPromptSnoozed(now)).toBe(false);
    snoozePushPrompt(now);
    expect(isPushPromptSnoozed(now + PROMPT_SNOOZE_MS - 1)).toBe(true);
    expect(isPushPromptSnoozed(now + PROMPT_SNOOZE_MS + 1)).toBe(false);
    store.set('po:push', 'on');
    store.set('po:push-row', ROW_ID);
    clearPushPrefs();
    expect(store.size).toBe(0);
  });
});

describe('turning push off / removing this device', () => {
  it('disablePush deletes by session and by remembered row id — never by token — then invalidates the FCM token', async () => {
    store.set('po:push', 'on');
    const { supabase, calls } = client();
    await savePushToken(supabase, reg('mine'));
    await disablePush(supabase);
    expect(isPushOptedOut()).toBe(true);
    expect(store.get('po:push')).toBe('off');
    const deletes = calls.filter((c) => c.op === 'delete');
    expect(deletes).toEqual([
      { op: 'delete', table: 'push_tokens', filters: [`session_id=${SID}`] },
      { op: 'delete', table: 'push_tokens', filters: [`id=${ROW_ID}`] },
    ]);
    expect(JSON.stringify(deletes)).not.toContain('mine');
    expect(store.has('po:push-row')).toBe(false);
    expect(fake.unregister).toHaveBeenCalledTimes(1);
  });

  it('offline "off" throws (Profile shows it) and stays pending; the next online start finishes the delete', async () => {
    store.set('po:push', 'on');
    fake.perm = 'granted';
    const offline = client({ fail: true });
    await savePushToken(offline.supabase, reg('mine'));
    await expect(disablePush(offline.supabase)).rejects.toThrow('push-off-incomplete');
    expect(store.get('po:push')).toBe('off-pending');
    expect(isPushOptedOut()).toBe(true);
    expect(store.get('po:push-row')).toBe(ROW_ID);

    // Next launch, still offline: retried, still pending, never re-registered.
    await resumePush(client({ fail: true }).supabase);
    expect(store.get('po:push')).toBe('off-pending');
    expect(fake.register).not.toHaveBeenCalled();

    // Next launch, online: the delete goes through and the state settles.
    const online = client();
    await resumePush(online.supabase);
    expect(online.calls).toEqual([
      { op: 'delete', table: 'push_tokens', filters: [`session_id=${SID}`] },
      { op: 'delete', table: 'push_tokens', filters: [`id=${ROW_ID}`] },
    ]);
    expect(store.get('po:push')).toBe('off');
    expect(store.has('po:push-row')).toBe(false);
    expect(fake.register).not.toHaveBeenCalled();

    // Settled: later starts send nothing.
    const later = client();
    await resumePush(later.supabase);
    expect(later.calls).toEqual([]);
  });

  it('without a session or a remembered row there is nothing to delete by', async () => {
    const { supabase, calls } = client({ session: false });
    await expect(deleteThisDevicePushTokens(supabase)).resolves.toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('sign-out steps', () => {
  it('step 1 never hangs: a stuck delete is aborted after the timeout', async () => {
    vi.useFakeTimers();
    const { supabase } = client({ hang: true });
    let done = false;
    void unregisterPushForSignOut(supabase).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(SIGN_OUT_PUSH_TIMEOUT_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });

  it('step 1 does not touch the transport token (that is step 2, after the session is gone)', async () => {
    await unregisterPushForSignOut(client().supabase);
    expect(fake.unregister).not.toHaveBeenCalled();
    await invalidatePushTransportForSignOut();
    expect(fake.unregister).toHaveBeenCalledTimes(1);
  });

  it('race: a delete that answers after the cap cannot undo the re-registration that followed', async () => {
    vi.useFakeTimers();
    store.set('po:push', 'on');
    fake.perm = 'granted';
    const first = client();
    await savePushToken(first.supabase, reg('fcm-token-1'));

    const slow = client({ late: true });
    const step = unregisterPushForSignOut(slow.supabase);
    await vi.advanceTimersByTimeAsync(SIGN_OUT_PUSH_TIMEOUT_MS + 1);
    await step; // capped: sign-out moved on

    // sign-out-incomplete: still signed in, so push is resumed.
    const again = client();
    await resumePush(again.supabase);
    expect(again.calls.filter((c) => c.op === 'upsert')).toHaveLength(1); // re-upserted, not deduped away
    expect(store.get('po:push-row')).toBe(ROW_ID);

    // The network comes back and the abandoned request would have answered now.
    slow.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(store.get('po:push-row')).toBe(ROW_ID); // bookkeeping untouched
    expect(fake.unregister).not.toHaveBeenCalled(); // and the FCM token is alive
  });

  it('resume abandons a sign-out step still in flight (before its cap)', async () => {
    vi.useFakeTimers();
    store.set('po:push', 'on');
    store.set('po:push-row', ROW_ID);
    const slow = client({ late: true });
    let done = false;
    void unregisterPushForSignOut(slow.supabase).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    await resumePush(client().supabase);
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    slow.release();
    await vi.advanceTimersByTimeAsync(10);
    expect(store.get('po:push-row')).toBe(ROW_ID);
  });
});
