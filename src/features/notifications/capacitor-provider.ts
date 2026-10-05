// Native push transport (Fase 17 N5, 86ey6bfkb): FCM through
// @capacitor/push-notifications inside the Capacitor shell. Selected by
// `getNotificationProvider()` when `isNativeShell()`; never constructed on the web.
//
// Two gates before any call that reaches Firebase:
//  1. The shell hands JS an FCM registration token. Android always does. On iOS
//     the push plugin alone would emit the raw APNs device token, which
//     push-dispatch (FCM only) cannot deliver to; the AppDelegate (S1b,
//     86exxuvye) routes APNs through Firebase Messaging and emits the FCM token
//     instead, and the iOS `PlusOnePushConfig` says so with
//     `tokenTransport: 'fcm'`. An iOS shell that does not say so (built before
//     it) stays `unsupported`. Belt and braces: an iOS token shaped like a raw
//     APNs token (64 hex) is never handed on.
//  2. Firebase actually configured in this build. Without google-services.json
//     (Android) the plugin's register()/unregister() throw natively and crash the
//     app; without GoogleService-Info.plist (iOS) the AppDelegate never starts
//     Firebase. So the local `PlusOnePushConfig` plugin
//     (android/…/PushConfigPlugin.java, ios/App/App/PushConfigPlugin.swift) is
//     asked first. A build without it (or an older shell) answers "not
//     configured" by rejecting, which lands on the same safe path.
//
// Opt-in stays explicit on both platforms: Firebase auto-init is off in the
// manifest / Info.plist, so nothing creates a token before register() — which
// push-client only calls after the person said yes. Token rotation arrives as a
// later `registration` event (Android: the plugin's onNewToken; iOS: the
// AppDelegate's MessagingDelegate) and goes through `onRegistration`.
//
// The plugin is imported lazily so the web bundle never loads it (same pattern as
// the N3 back button).
import type { PluginListenerHandle } from '@capacitor/core';
import type { PushNotificationsPlugin, PermissionStatus } from '@capacitor/push-notifications';
import { t } from '@/lib/i18n';
import type { NotificationProvider, PushMessage, PushPermission, PushRegistration, Unsubscribe } from './provider';
import { PUSH_TRANSPORT, type PushDevicePlatform } from './transport';

/** Keep in sync with `plusone_push_channel_id` in android/app/src/main/res/values/plusone_push.xml. */
export const PUSH_CHANNEL_ID = 'approvals';
/** FCM usually answers in well under a second; past this the registration counts as failed. */
export const REGISTER_TIMEOUT_MS = 15_000;
/** The launch-tap read is one bridge round trip; an older shell without it may
 *  never answer, so it counts as "no launch tap" past this. */
export const LAUNCH_TAP_TIMEOUT_MS = 1_000;
/** A listener whose plugin load failed (a transient chunk fetch) tries again this often. */
export const LISTEN_RETRY_MS = 2_000;
export const LISTEN_RETRIES = 3;
/** iOS FCM token delete is a network call; "off" and sign-out never wait longer. */
export const INVALIDATE_TIMEOUT_MS = 3_000;

interface PushConfigPlugin {
  /** `tokenTransport` (iOS only, 86exxuvye): 'fcm' when this shell emits FCM
   *  tokens rather than raw APNs tokens. Absent on Android (always FCM). */
  isConfigured(): Promise<{ configured: boolean; tokenTransport?: string }>;
  /** Added for 86ey6bfkb (Bug 5): the FCM extras of the launch Intent, once per
   *  tap. `{}` when there is none. Missing on shells built before it. */
  getLaunchTarget(): Promise<{ id?: string; data?: Record<string, unknown> }>;
  /** iOS only (86exxuvye): auto-init off + delete the FCM token — what the
   *  Android push plugin's own unregister() already does. */
  invalidateToken?(): Promise<void>;
}

/** A raw APNs device token as the push plugin would emit it on iOS: 32 bytes hex. */
const APNS_TOKEN_RE = /^[0-9a-f]{64}$/i;

// THE THENABLE TRAP — do not "simplify" these wrappers away. A Capacitor plugin
// is a Proxy whose `get` hands out a native-method wrapper for every property
// (only `$$typeof`, `toJSON`, `addListener`, `removeListener` are special),
// `then` included. So the moment a plugin becomes a promise's resolution value
// (returned from an async function or a `.then` callback, or `await`ed
// directly) the promise machinery calls `plugin.then(resolve, reject)`: a
// native call to a method that does not exist, whose failure never reaches
// resolve/reject — the promise never settles. That hung `ready()` on device
// (86ey6bfkb). A plugin only ever crosses a promise boundary inside a plain
// `{ plugin }` / `{ push }` object; only the results of its methods are awaited.
export interface Loaded<T> {
  plugin: T;
}

export interface CapacitorPushDeps {
  platform(): string;
  loadPush(): Promise<Loaded<PushNotificationsPlugin>>;
  loadConfig(): Promise<Loaded<PushConfigPlugin>>;
}

export const defaultDeps: CapacitorPushDeps = {
  platform: () => {
    if (typeof window === 'undefined') return 'web';
    const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    return cap?.getPlatform?.() ?? 'web';
  },
  // Wrapped, never returned bare — see the thenable trap above.
  loadPush: async () => ({ plugin: (await import('@capacitor/push-notifications')).PushNotifications }),
  loadConfig: async () => ({ plugin: (await import('@capacitor/core')).registerPlugin<PushConfigPlugin>('PlusOnePushConfig') }),
};

function toPermission(status: PermissionStatus): PushPermission {
  if (status.receive === 'granted') return 'granted';
  if (status.receive === 'denied') return 'denied';
  return 'default'; // 'prompt' | 'prompt-with-rationale'
}

function toMessage(raw: unknown): PushMessage {
  const r = raw as { id?: unknown; data?: unknown } | null;
  const data = r?.data;
  const msg: PushMessage = { data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {} };
  if (typeof r?.id === 'string' && r.id) msg.id = r.id;
  return msg;
}

/** What `ready()` hands out — wrapped plugins only (thenable trap). */
interface Ready {
  push: PushNotificationsPlugin;
  config: PushConfigPlugin;
}

export class CapacitorPushProvider implements NotificationProvider {
  private readyP: Promise<Ready | null> | null = null;

  constructor(private readonly deps: CapacitorPushDeps = defaultDeps) {}

  /** FCM token; the platform comes from the shell itself, so an iPhone (FCM
   *  too, through the AppDelegate) is never labelled `android`. Null for a token
   *  that cannot be an FCM one (a raw APNs token on iOS — gate 1). */
  private registration(token: string): PushRegistration | null {
    const p = this.deps.platform();
    const platform: PushDevicePlatform = p === 'android' || p === 'ios' ? p : 'web';
    if (platform === 'ios' && APNS_TOKEN_RE.test(token)) return null;
    return { token, transport: PUSH_TRANSPORT.fcm, platform };
  }

  /** The native shells. Whether THIS build can push (Firebase configured, FCM
   *  tokens on iOS) is settled asynchronously by `ready()`; until then every
   *  path answers `unsupported` / null. */
  isSupported(): boolean {
    const p = this.deps.platform();
    return p === 'android' || p === 'ios';
  }

  /** Set when the last `ready()` failed on an error (not on a clean "no"). */
  private readyFailed = false;

  /** The push plugin (wrapped — thenable trap), or null when this build must not touch Firebase. A clean
   *  answer (supported or not, configured or not) is memoized for the run; a
   *  failure (e.g. a lazy chunk that did not load) is not, so the next call tries
   *  again — the shell must never depend on the service worker having cached it. */
  private ready(): Promise<Ready | null> {
    this.readyP ??= (async (): Promise<Ready | null> => {
      if (!this.isSupported()) return null;
      const { plugin: config } = await this.deps.loadConfig();
      const { configured, tokenTransport } = await config.isConfigured();
      if (!configured) return null;
      if (this.deps.platform() === 'ios' && tokenTransport !== 'fcm') return null;
      const { plugin: push } = await this.deps.loadPush();
      // The channel the manifest names as FCM's default. Creating an existing
      // channel is a no-op on Android, so this is safe on every start. iOS has
      // no channels (the plugin rejects; swallowed).
      if (this.deps.platform() === 'android') await push
        .createChannel({
          id: PUSH_CHANNEL_ID,
          name: t.push.channelName,
          description: t.push.channelDescription,
          importance: 4,
        })
        .catch(() => undefined);
      return { push, config };
    })().then(
      (loaded) => {
        this.readyFailed = false;
        return loaded;
      },
      () => {
        this.readyFailed = true;
        this.readyP = null;
        return null;
      },
    );
    return this.readyP;
  }

  async checkPermission(): Promise<PushPermission> {
    const push = (await this.ready())?.push;
    if (!push) return 'unsupported';
    try {
      return toPermission(await push.checkPermissions());
    } catch {
      return 'unsupported';
    }
  }

  async requestPermission(): Promise<PushPermission> {
    const push = (await this.ready())?.push;
    if (!push) return 'unsupported';
    try {
      return toPermission(await push.requestPermissions());
    } catch {
      return 'denied';
    }
  }

  async register(): Promise<PushRegistration | null> {
    const push = (await this.ready())?.push;
    if (!push) return null;
    if ((await this.checkPermission()) !== 'granted') return null;
    return new Promise<PushRegistration | null>((resolve) => {
      let done = false;
      const handles: Promise<PluginListenerHandle>[] = [];
      const finish = (value: PushRegistration | null): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        for (const h of handles) void h.then((x) => x.remove()).catch(() => undefined);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), REGISTER_TIMEOUT_MS);
      handles.push(
        push.addListener('registration', ({ value }) => finish(value ? this.registration(value) : null)),
        push.addListener('registrationError', () => finish(null)),
      );
      push.register().catch(() => finish(null));
    });
  }

  /** Android: the plugin's unregister() turns auto-init off and deletes the FCM
   *  token. iOS: the plugin only drops the APNs registration, so the config
   *  plugin's `invalidateToken` does the FCM half — the same end state. */
  async unregister(): Promise<void> {
    const loaded = await this.ready();
    if (!loaded) return;
    await loaded.push.unregister().catch(() => undefined);
    if (this.deps.platform() !== 'ios') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      (async () => loaded.config.invalidateToken?.())().catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, INVALIDATE_TIMEOUT_MS);
      }),
    ]).finally(() => clearTimeout(timer));
  }

  private listen(event: 'registration' | 'pushNotificationActionPerformed' | 'pushNotificationReceived', cb: (raw: unknown) => void): Unsubscribe {
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attach = (attemptsLeft: number): void => {
      void this.ready()
        .then((loaded) => {
          if (cancelled) return null;
          if (!loaded) {
            // A failed plugin load retries, so a retained cold-start tap is not
            // lost to one bad chunk fetch; a clean "no Firebase" does not.
            if (this.readyFailed && attemptsLeft > 0) retry = setTimeout(() => attach(attemptsLeft - 1), LISTEN_RETRY_MS);
            return null;
          }
          return loaded.push.addListener(event as 'registration', cb as (raw: { value: string }) => void);
        })
        .then((h) => {
          if (!h) return;
          if (cancelled) void h.remove().catch(() => undefined);
          else handle = h;
        })
        .catch(() => undefined);
    };
    attach(LISTEN_RETRIES);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      if (handle) void handle.remove().catch(() => undefined);
    };
  }

  onRegistration(cb: (reg: PushRegistration) => void): Unsubscribe {
    return this.listen('registration', (raw) => {
      const value = (raw as { value?: unknown } | null)?.value;
      const reg = typeof value === 'string' && value ? this.registration(value) : null;
      if (reg) cb(reg);
    });
  }

  onTap(cb: (msg: PushMessage) => void): Unsubscribe {
    return this.listen('pushNotificationActionPerformed', (raw) => cb(toMessage((raw as { notification?: unknown } | null)?.notification)));
  }

  onForeground(cb: (msg: PushMessage) => void): Unsubscribe {
    return this.listen('pushNotificationReceived', (raw) => cb(toMessage(raw)));
  }

  /** Asks the local config plugin only — not `ready()`: no push plugin load, no
   *  channel, no Firebase. That is what makes it early enough to route before the
   *  first screen paints (86ey6bfkb). The retained `pushNotificationActionPerformed`
   *  for the same tap still arrives later; the caller dedupes on `id`. */
  async takeLaunchTap(): Promise<PushMessage | null> {
    if (!this.isSupported()) return null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), LAUNCH_TAP_TIMEOUT_MS);
    });
    const read = (async (): Promise<PushMessage | null> => {
      const { plugin: config } = await this.deps.loadConfig();
      const raw = await config.getLaunchTarget();
      return raw && raw.data && typeof raw.data === 'object' ? toMessage(raw) : null;
    })().catch(() => null);
    try {
      return await Promise.race([read, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}
