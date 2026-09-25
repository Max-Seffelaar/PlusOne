// Native push transport (Fase 17 N5, 86ey6bfkb): FCM through
// @capacitor/push-notifications inside the Capacitor shell. Selected by
// `getNotificationProvider()` when `isNativeShell()`; never constructed on the web.
//
// Two gates before any call that reaches Firebase:
//  1. Android only. On iOS the plugin hands out a raw APNs token, not an FCM one,
//     and push-dispatch only speaks FCM — iOS needs Firebase Messaging in the
//     AppDelegate first (S1b). Until then iOS reports `unsupported`.
//  2. Firebase actually configured in this build. Without google-services.json
//     the plugin's register()/unregister() throw natively and crash the app, so
//     the local `PlusOnePushConfig` plugin (android/…/PushConfigPlugin.java) is
//     asked first. A build without it (or an older shell) answers "not
//     configured" by rejecting, which lands on the same safe path.
//
// The plugin is imported lazily so the web bundle never loads it (same pattern as
// the N3 back button).
import type { PluginListenerHandle } from '@capacitor/core';
import type { PushNotificationsPlugin, PermissionStatus } from '@capacitor/push-notifications';
import { t } from '@/lib/i18n';
import type { NotificationProvider, PushMessage, PushPermission, PushRegistration, Unsubscribe } from './provider';

/** Keep in sync with `plusone_push_channel_id` in android/app/src/main/res/values/plusone_push.xml. */
export const PUSH_CHANNEL_ID = 'approvals';
/** FCM usually answers in well under a second; past this the registration counts as failed. */
export const REGISTER_TIMEOUT_MS = 15_000;

interface PushConfigPlugin {
  isConfigured(): Promise<{ configured: boolean }>;
}

export interface CapacitorPushDeps {
  platform(): string;
  loadPush(): Promise<PushNotificationsPlugin>;
  loadConfig(): Promise<PushConfigPlugin>;
}

const defaultDeps: CapacitorPushDeps = {
  platform: () => {
    if (typeof window === 'undefined') return 'web';
    const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
    return cap?.getPlatform?.() ?? 'web';
  },
  loadPush: async () => (await import('@capacitor/push-notifications')).PushNotifications,
  loadConfig: async () => (await import('@capacitor/core')).registerPlugin<PushConfigPlugin>('PlusOnePushConfig'),
};

function toPermission(status: PermissionStatus): PushPermission {
  if (status.receive === 'granted') return 'granted';
  if (status.receive === 'denied') return 'denied';
  return 'default'; // 'prompt' | 'prompt-with-rationale'
}

function toMessage(raw: unknown): PushMessage {
  const data = (raw as { data?: unknown } | null)?.data;
  return { data: data && typeof data === 'object' ? (data as Record<string, unknown>) : {} };
}

export class CapacitorPushProvider implements NotificationProvider {
  private readyP: Promise<PushNotificationsPlugin | null> | null = null;

  constructor(private readonly deps: CapacitorPushDeps = defaultDeps) {}

  isSupported(): boolean {
    return this.deps.platform() === 'android';
  }

  /** The push plugin, or null when this build must not touch Firebase. Memoized. */
  private ready(): Promise<PushNotificationsPlugin | null> {
    this.readyP ??= (async () => {
      if (!this.isSupported()) return null;
      const { configured } = await (await this.deps.loadConfig()).isConfigured();
      if (!configured) return null;
      const push = await this.deps.loadPush();
      // The channel the manifest names as FCM's default. Creating an existing
      // channel is a no-op on Android, so this is safe on every start.
      await push
        .createChannel({
          id: PUSH_CHANNEL_ID,
          name: t.push.channelName,
          description: t.push.channelDescription,
          importance: 4,
        })
        .catch(() => undefined);
      return push;
    })().catch(() => null);
    return this.readyP;
  }

  async checkPermission(): Promise<PushPermission> {
    const push = await this.ready();
    if (!push) return 'unsupported';
    try {
      return toPermission(await push.checkPermissions());
    } catch {
      return 'unsupported';
    }
  }

  async requestPermission(): Promise<PushPermission> {
    const push = await this.ready();
    if (!push) return 'unsupported';
    try {
      return toPermission(await push.requestPermissions());
    } catch {
      return 'denied';
    }
  }

  async register(): Promise<PushRegistration | null> {
    const push = await this.ready();
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
        push.addListener('registration', ({ value }) => finish(value ? { token: value, transport: 'fcm' } : null)),
        push.addListener('registrationError', () => finish(null)),
      );
      push.register().catch(() => finish(null));
    });
  }

  async unregister(): Promise<void> {
    const push = await this.ready();
    if (!push) return;
    await push.unregister().catch(() => undefined);
  }

  private listen(event: 'registration' | 'pushNotificationActionPerformed' | 'pushNotificationReceived', cb: (raw: unknown) => void): Unsubscribe {
    let cancelled = false;
    let handle: PluginListenerHandle | null = null;
    void this.ready()
      .then((push) => (push ? push.addListener(event as 'registration', cb as (raw: { value: string }) => void) : null))
      .then((h) => {
        if (!h) return;
        if (cancelled) void h.remove().catch(() => undefined);
        else handle = h;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (handle) void handle.remove().catch(() => undefined);
    };
  }

  onRegistration(cb: (reg: PushRegistration) => void): Unsubscribe {
    return this.listen('registration', (raw) => {
      const value = (raw as { value?: unknown } | null)?.value;
      if (typeof value === 'string' && value) cb({ token: value, transport: 'fcm' });
    });
  }

  onTap(cb: (msg: PushMessage) => void): Unsubscribe {
    return this.listen('pushNotificationActionPerformed', (raw) => cb(toMessage((raw as { notification?: unknown } | null)?.notification)));
  }

  onForeground(cb: (msg: PushMessage) => void): Unsubscribe {
    return this.listen('pushNotificationReceived', (raw) => cb(toMessage(raw)));
  }
}
