import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  NoopNotificationProvider,
  type NotificationProvider,
  getNotificationProvider,
  selectNotificationProvider,
  __resetNotificationProviderForTests,
} from './provider';
import { CapacitorPushProvider } from './capacitor-provider';

describe('NoopNotificationProvider (web / SSR)', () => {
  it('reports push as unsupported and never registers', async () => {
    const p = new NoopNotificationProvider();
    expect(p.isSupported()).toBe(false);
    await expect(p.checkPermission()).resolves.toBe('unsupported');
    await expect(p.requestPermission()).resolves.toBe('unsupported');
    await expect(p.register()).resolves.toBeNull();
    await expect(p.unregister()).resolves.toBeUndefined();
  });

  it('listener registration is a harmless no-op', () => {
    const p: NotificationProvider = new NoopNotificationProvider();
    expect(() => p.onRegistration(() => {})()).not.toThrow();
    expect(() => p.onTap(() => {})()).not.toThrow();
    expect(() => p.onForeground(() => {})()).not.toThrow();
  });
});

describe('provider selection (N5: native shell → Capacitor, else no-op; no web-push adapter in v1)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetNotificationProviderForTests();
  });

  it('selects the Capacitor provider only for the native shell', () => {
    expect(selectNotificationProvider(true)).toBeInstanceOf(CapacitorPushProvider);
    expect(selectNotificationProvider(false)).toBeInstanceOf(NoopNotificationProvider);
  });

  it('is the no-op on the server (no window)', () => {
    expect(getNotificationProvider()).toBeInstanceOf(NoopNotificationProvider);
  });

  it('is the no-op in a plain browser', () => {
    vi.stubGlobal('window', {});
    expect(getNotificationProvider()).toBeInstanceOf(NoopNotificationProvider);
  });

  it('is the Capacitor provider inside the native shell, and a stable instance', () => {
    vi.stubGlobal('window', { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } });
    const first = getNotificationProvider();
    expect(first).toBeInstanceOf(CapacitorPushProvider);
    expect(getNotificationProvider()).toBe(first);
  });
});

describe('push transports', () => {
  it('match the push_tokens.transport check constraint in the N2 migration', async () => {
    const { readFileSync } = await import('node:fs');
    const { PUSH_TRANSPORTS, PUSH_TRANSPORT } = await import('./transport');
    const sql = readFileSync('supabase/migrations/20260925120000_push_tokens_outbox.sql', 'utf8');
    const m = sql.match(/transport text not null check \(transport in \(([^)]*)\)\)/);
    expect(m).not.toBeNull();
    const values = m![1].split(',').map((v) => v.trim().replace(/^'|'$/g, ''));
    expect([...PUSH_TRANSPORTS].sort()).toEqual(values.sort());
    expect(Object.values(PUSH_TRANSPORT).sort()).toEqual(values.sort());
  });
});
