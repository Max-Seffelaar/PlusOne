import { describe, it, expect, afterEach, vi } from 'vitest';
import { clearDeviceCaches } from './sw-cache';

type Global = typeof globalThis & { caches?: unknown };

function stubCaches(names: string[]): { deleted: string[] } {
  const deleted: string[] = [];
  (globalThis as Global).caches = {
    keys: async () => names,
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    },
  };
  return { deleted };
}

afterEach(() => {
  delete (globalThis as Global).caches;
  vi.restoreAllMocks();
});

describe('clearDeviceCaches (shared-device sign-out, 86ey9e9mn)', () => {
  it('wipes the session cache holding credentialed /app HTML', async () => {
    const { deleted } = stubCaches(['plusone-session-v1', 'plusone-shell-v2']);
    await clearDeviceCaches();
    expect(deleted).toEqual(['plusone-session-v1']);
  });

  it('keeps the PII-free shell so the next doorhost still boots offline (#25)', async () => {
    const { deleted } = stubCaches(['plusone-shell-v2', 'plusone-shell-v3']);
    await clearDeviceCaches();
    expect(deleted).toEqual([]);
  });

  it('wipes legacy caches it did not create — incl. the retired Workbox buckets', async () => {
    // The next-pwa SW cached cross-origin GETs (Supabase REST = guest PII) under
    // its own names; a device that ran it must be cleaned by the same sign-out.
    const { deleted } = stubCaches([
      'plusone-door-v1',
      'workbox-precache-v2',
      'apis',
      'cross-origin',
      'others',
      'plusone-shell-v2',
    ]);
    await clearDeviceCaches();
    expect(deleted).toEqual(['plusone-door-v1', 'workbox-precache-v2', 'apis', 'cross-origin', 'others']);
  });

  it('no-ops without CacheStorage (webview / non-secure context, #37)', async () => {
    delete (globalThis as Global).caches;
    await expect(clearDeviceCaches()).resolves.toBeUndefined();
  });

  it('swallows storage errors — sign-out must never strand the user', async () => {
    (globalThis as Global).caches = {
      keys: async () => {
        throw new Error('QuotaExceededError');
      },
      delete: async () => true,
    };
    await expect(clearDeviceCaches()).resolves.toBeUndefined();
  });
});
