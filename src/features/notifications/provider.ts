// Notifications abstraction (CLAUDE.md #37): the app never calls web-push or FCM/APNs
// directly. Every push side effect goes through a NotificationProvider, so the
// browser→native swap (Capacitor wrap, Phase 3) touches only this file — same pattern
// as BillingProvider. MVP ships the no-op stub: no push yet, but the seam exists so no
// screen hardcodes a transport.

export type PushPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface PushRegistration {
  /** Opaque transport token: web-push endpoint/keys (browser) or FCM/APNs token (native). */
  token: string;
  transport: 'web-push' | 'fcm' | 'apns';
}

export interface NotificationProvider {
  isSupported(): boolean;
  requestPermission(): Promise<PushPermission>;
  register(): Promise<PushRegistration | null>;
  unregister(): Promise<void>;
}

// MVP stub: no transport wired. Reports 'unsupported' so callers degrade cleanly.
export class NoopNotificationProvider implements NotificationProvider {
  isSupported() {
    return false;
  }
  async requestPermission(): Promise<PushPermission> {
    return 'unsupported';
  }
  async register() {
    return null;
  }
  async unregister() {}
}

// The single provider instance the app reads from. Replace the construction here when
// the web-push / FCM / APNs adapter ships; callers never change.
export const notifications: NotificationProvider = new NoopNotificationProvider();
