// Notifications abstraction (CLAUDE.md #37): the app never calls web-push or FCM/APNs
// directly. Every push side effect goes through a NotificationProvider, so the
// browser→native swap touches only this folder — same pattern as BillingProvider.
//
// Two providers (Fase 17 N5, 86ey6bfkb; plan §2 decisions 1–2):
//  - `CapacitorPushProvider` inside the native shell (FCM via
//    @capacitor/push-notifications). Android in v1; iOS joins in S1b.
//  - `NoopNotificationProvider` everywhere else. There is deliberately NO web-push
//    adapter in v1 — `'web-push'` stays in the transport enum for later.
//
// A provider is transport only: permission, token, incoming messages. What the app
// does with a token (store it in `push_tokens`) and with a tap (navigate) lives in
// `push-client.ts` and the po chrome, never in here.
import { isNativeShell } from '@/lib/platform';
import { CapacitorPushProvider } from './capacitor-provider';
import type { PushDevicePlatform, PushTransport } from './transport';

/** `default` = never asked (or asked-and-dismissed on Android <13's model): we may prompt. */
export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushRegistration {
  /** Opaque transport token: web-push endpoint/keys (browser) or FCM/APNs token (native). */
  token: string;
  transport: PushTransport;
  /** The platform that issued it — what `device_label` records. */
  platform: PushDevicePlatform;
}

/** A received push. `data` is the FCM data map: ids + kind only, all strings (N2 payload). */
export interface PushMessage {
  data: Record<string, unknown>;
}

export type Unsubscribe = () => void;

export interface NotificationProvider {
  /** The platform can do push at all (sync, no I/O). Callers skip every push path when false. */
  isSupported(): boolean;
  /** Current permission, never prompts. `unsupported` when this build cannot register. */
  checkPermission(): Promise<PushPermission>;
  /** Shows the OS prompt when the permission is still `default`. */
  requestPermission(): Promise<PushPermission>;
  /** Resolves this device's current token, or null (no permission, no Firebase, error, timeout). */
  register(): Promise<PushRegistration | null>;
  /** Invalidates the device token at the transport. Never throws. */
  unregister(): Promise<void>;
  /** Every token the transport hands out, including later refreshes. */
  onRegistration(cb: (reg: PushRegistration) => void): Unsubscribe;
  /** The user tapped a notification (cold start included — the event is retained natively). */
  onTap(cb: (msg: PushMessage) => void): Unsubscribe;
  /** A push arrived while the app is in the foreground (no system notification is shown). */
  onForeground(cb: (msg: PushMessage) => void): Unsubscribe;
}

const noop: Unsubscribe = () => {};

// Web / SSR / tests: no transport. Reports 'unsupported' so callers degrade cleanly.
export class NoopNotificationProvider implements NotificationProvider {
  isSupported() {
    return false;
  }
  async checkPermission(): Promise<PushPermission> {
    return 'unsupported';
  }
  async requestPermission(): Promise<PushPermission> {
    return 'unsupported';
  }
  async register() {
    return null;
  }
  async unregister() {}
  onRegistration() {
    return noop;
  }
  onTap() {
    return noop;
  }
  onForeground() {
    return noop;
  }
}

/** Runtime selection. Pure so it is testable without a module-level singleton. */
export function selectNotificationProvider(native: boolean): NotificationProvider {
  return native ? new CapacitorPushProvider() : new NoopNotificationProvider();
}

let instance: NotificationProvider | null = null;

/** The single provider instance the app reads from. Selected on first use in the
 *  browser (not at import: the server bundle imports this too, and a module-level
 *  `window` read would pin SSR's answer). Callers never construct a provider. */
export function getNotificationProvider(): NotificationProvider {
  if (typeof window === 'undefined') return new NoopNotificationProvider();
  instance ??= selectNotificationProvider(isNativeShell());
  return instance;
}

/** Tests only. */
export function __resetNotificationProviderForTests(): void {
  instance = null;
}
