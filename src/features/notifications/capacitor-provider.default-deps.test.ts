/**
 * The real loaders (`defaultDeps`) must hand the plugin over inside a wrapper,
 * never as the resolution value itself: a Capacitor plugin proxy is thenable and
 * would hang the promise forever (86ey6bfkb). Both modules are mocked with
 * plugins built the way `registerPlugin` builds them, so no native bridge is
 * needed.
 */
import { describe, expect, it, vi } from 'vitest';

function thenableProxy(name: string): object {
  return new Proxy(
    { name },
    {
      get(t, prop) {
        if (prop === '$$typeof') return undefined;
        if (prop === 'name') return t.name;
        return () => new Promise<never>(() => undefined);
      },
    },
  );
}

const pushPlugin = thenableProxy('PushNotifications');
const configPlugin = thenableProxy('PlusOnePushConfig');

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: pushPlugin }));
vi.mock('@capacitor/core', () => ({ registerPlugin: vi.fn(() => configPlugin) }));

const { defaultDeps } = await import('./capacitor-provider');

function settles<T>(p: Promise<T>, ms = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const hung = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('hung: promise never settled')), ms);
  });
  return Promise.race([p, hung]).finally(() => clearTimeout(timer));
}

describe('defaultDeps loaders resolve to a wrapper, not the thenable plugin proxy', () => {
  it('loadPush', async () => {
    const loaded = await settles(defaultDeps.loadPush());
    expect(loaded.plugin).toBe(pushPlugin);
  });

  it('loadConfig registers PlusOnePushConfig', async () => {
    const loaded = await settles(defaultDeps.loadConfig());
    expect(loaded.plugin).toBe(configPlugin);
    const { registerPlugin } = await import('@capacitor/core');
    expect(registerPlugin).toHaveBeenCalledWith('PlusOnePushConfig');
  });
});
