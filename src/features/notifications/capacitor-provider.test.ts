/**
 * CapacitorPushProvider (Fase 17 N5). The load-bearing property is the crash
 * guard: without google-services.json the push plugin's register()/unregister()
 * throw natively and kill the app, so the provider must never reach them unless
 * the local PlusOnePushConfig plugin says Firebase is configured.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CapacitorPushProvider,
  LISTEN_RETRY_MS,
  PUSH_CHANNEL_ID,
  REGISTER_TIMEOUT_MS,
  type CapacitorPushDeps,
} from './capacitor-provider';

type Listener = (e: unknown) => void;

function fakePush() {
  const listeners = new Map<string, Listener[]>();
  const perm = { receive: 'prompt' };
  const push = {
    listeners,
    emit(event: string, payload: unknown): void {
      for (const l of listeners.get(event) ?? []) l(payload);
    },
    get receive(): string {
      return perm.receive;
    },
    set receive(v: string) {
      perm.receive = v;
    },
    createChannel: vi.fn(async (_c: { id: string; importance?: number }) => undefined),
    checkPermissions: vi.fn(async () => ({ receive: perm.receive })),
    requestPermissions: vi.fn(async () => ({ receive: perm.receive })),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, fn: Listener) => {
      listeners.set(event, [...(listeners.get(event) ?? []), fn]);
      return {
        remove: async () => {
          listeners.set(event, (listeners.get(event) ?? []).filter((x) => x !== fn));
        },
      };
    }),
  };
  return push;
}

let push: ReturnType<typeof fakePush>;
let configured: boolean | 'reject';
let platform: string;

function deps(): CapacitorPushDeps {
  return {
    platform: () => platform,
    loadPush: async () => push as never,
    loadConfig: async () => ({
      isConfigured: async () => {
        if (configured === 'reject') throw new Error('"PlusOnePushConfig" plugin is not implemented on android');
        return { configured };
      },
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  push = fakePush();
  configured = true;
  platform = 'android';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('gates: never touch Firebase when this build cannot push', () => {
  it.each([
    ['iOS (APNs token until S1b)', 'ios', true],
    ['Android without google-services.json', 'android', false],
    ['an older shell without the config plugin', 'android', 'reject'],
  ] as const)('%s → unsupported, and register/unregister never reach the plugin', async (_label, plat, conf) => {
    platform = plat;
    configured = conf;
    const p = new CapacitorPushProvider(deps());
    await expect(p.checkPermission()).resolves.toBe('unsupported');
    await expect(p.requestPermission()).resolves.toBe('unsupported');
    await expect(p.register()).resolves.toBeNull();
    await expect(p.unregister()).resolves.toBeUndefined();
    expect(push.register).not.toHaveBeenCalled();
    expect(push.unregister).not.toHaveBeenCalled();
    expect(push.requestPermissions).not.toHaveBeenCalled();
  });

  it('isSupported is Android only', () => {
    expect(new CapacitorPushProvider(deps()).isSupported()).toBe(true);
    platform = 'ios';
    expect(new CapacitorPushProvider(deps()).isSupported()).toBe(false);
  });
});

describe('configured Android build', () => {
  it('creates the approvals channel (the manifest default) once', async () => {
    const p = new CapacitorPushProvider(deps());
    await p.checkPermission();
    await p.checkPermission();
    expect(push.createChannel).toHaveBeenCalledTimes(1);
    expect(push.createChannel).toHaveBeenCalledWith(expect.objectContaining({ id: PUSH_CHANNEL_ID, importance: 4 }));
  });

  it.each([
    ['granted', 'granted'],
    ['denied', 'denied'],
    ['prompt', 'default'],
    ['prompt-with-rationale', 'default'],
  ])('maps Capacitor %s → %s', async (receive, expected) => {
    push.receive = receive;
    await expect(new CapacitorPushProvider(deps()).checkPermission()).resolves.toBe(expected);
  });

  it('register() without permission does not call the plugin', async () => {
    push.receive = 'denied';
    await expect(new CapacitorPushProvider(deps()).register()).resolves.toBeNull();
    expect(push.register).not.toHaveBeenCalled();
  });

  it('register() resolves the FCM token from the registration event and drops its listeners', async () => {
    push.receive = 'granted';
    push.register.mockImplementation(async () => {
      setTimeout(() => push.emit('registration', { value: 'fcm-token-1' }), 0);
    });
    await expect(new CapacitorPushProvider(deps()).register()).resolves.toEqual({ token: 'fcm-token-1', transport: 'fcm', platform: 'android' });
    await flush();
    expect(push.listeners.get('registration') ?? []).toHaveLength(0);
    expect(push.listeners.get('registrationError') ?? []).toHaveLength(0);
  });

  it('register() resolves null on registrationError', async () => {
    push.receive = 'granted';
    push.register.mockImplementation(async () => {
      setTimeout(() => push.emit('registrationError', { error: 'SERVICE_NOT_AVAILABLE' }), 0);
    });
    await expect(new CapacitorPushProvider(deps()).register()).resolves.toBeNull();
  });

  it('register() gives up after the timeout', async () => {
    push.receive = 'granted';
    const p = new CapacitorPushProvider(deps());
    await p.checkPermission(); // warm the memoized plugin load with real timers
    vi.useFakeTimers();
    const result = p.register();
    await vi.advanceTimersByTimeAsync(REGISTER_TIMEOUT_MS + 1);
    await expect(result).resolves.toBeNull();
  });

  it('unregister() calls the plugin and swallows its failure', async () => {
    push.unregister.mockRejectedValueOnce(new Error('offline'));
    await expect(new CapacitorPushProvider(deps()).unregister()).resolves.toBeUndefined();
    expect(push.unregister).toHaveBeenCalledTimes(1);
  });

  it('onTap / onForeground / onRegistration hand over the data map, and unsubscribe', async () => {
    const p = new CapacitorPushProvider(deps());
    const taps: unknown[] = [];
    const fg: unknown[] = [];
    const regs: unknown[] = [];
    const offTap = p.onTap((m) => taps.push(m.data));
    p.onForeground((m) => fg.push(m.data));
    p.onRegistration((r) => regs.push(r));
    await flush();
    push.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: { id: 'x', data: { kind: 'guest_request_created' } } });
    push.emit('pushNotificationReceived', { id: 'y', data: { kind: 'quota_request_created' } });
    push.emit('registration', { value: 'refreshed' });
    expect(taps).toEqual([{ kind: 'guest_request_created' }]);
    expect(fg).toEqual([{ kind: 'quota_request_created' }]);
    expect(regs).toEqual([{ token: 'refreshed', transport: 'fcm', platform: 'android' }]);
    offTap();
    await flush();
    push.emit('pushNotificationActionPerformed', { notification: { data: {} } });
    expect(taps).toHaveLength(1);
  });

  it('an unsubscribe before the listener attached still detaches it', async () => {
    const p = new CapacitorPushProvider(deps());
    const seen: unknown[] = [];
    p.onTap((m) => seen.push(m))(); // unsubscribed synchronously
    await flush();
    await flush();
    push.emit('pushNotificationActionPerformed', { notification: { data: {} } });
    expect(seen).toEqual([]);
  });
});

describe('a transient plugin-load failure is not memoized', () => {
  function flakyDeps(failures: number): CapacitorPushDeps {
    let left = failures;
    return {
      ...deps(),
      loadPush: async () => {
        if (left > 0) {
          left -= 1;
          throw new Error('ChunkLoadError');
        }
        return push as never;
      },
    };
  }

  it('the next call loads the plugin again instead of staying "unsupported" for the run', async () => {
    push.receive = 'granted';
    const p = new CapacitorPushProvider(flakyDeps(1));
    await expect(p.checkPermission()).resolves.toBe('unsupported');
    await expect(p.checkPermission()).resolves.toBe('granted');
  });

  it('a listener retries, so a retained cold-start tap still arrives', async () => {
    vi.useFakeTimers();
    const p = new CapacitorPushProvider(flakyDeps(1));
    const taps: unknown[] = [];
    p.onTap((m) => taps.push(m.data));
    await vi.advanceTimersByTimeAsync(0);
    expect(push.addListener).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS + 1);
    push.emit('pushNotificationActionPerformed', { notification: { data: { kind: 'guest_request_created' } } });
    expect(taps).toEqual([{ kind: 'guest_request_created' }]);
  });

  it('a clean "no Firebase" is not retried', async () => {
    vi.useFakeTimers();
    configured = false;
    const loadConfig = vi.fn(deps().loadConfig);
    const p = new CapacitorPushProvider({ ...deps(), loadConfig });
    p.onTap(() => {});
    await vi.advanceTimersByTimeAsync(LISTEN_RETRY_MS * 5);
    expect(loadConfig).toHaveBeenCalledTimes(1);
    expect(push.addListener).not.toHaveBeenCalled();
  });
});

describe('registration platform', () => {
  it('comes from the shell, not a constant (S1b: an iPhone must never be labelled android)', async () => {
    const p = new CapacitorPushProvider(deps());
    const regs: unknown[] = [];
    p.onRegistration((r) => regs.push(r));
    await flush();
    await flush();
    platform = 'ios';
    push.emit('registration', { value: 't' });
    expect(regs).toEqual([{ token: 't', transport: 'fcm', platform: 'ios' }]);
  });
});
