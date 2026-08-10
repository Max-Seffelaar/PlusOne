import { describe, it, expect, afterEach } from 'vitest';
import { clearDeviceCaches } from './sw-cache';

// `caches` is declared non-optional on globalThis by lib.dom, so it can only be
// stubbed/removed through a cast that makes the property optional.
type CachesHolder = { caches?: CacheStorage };
const holder = globalThis as unknown as CachesHolder;

/** A full CacheStorage whose `keys`/`delete` are the only parts under test. */
function fakeCacheStorage(
  keys: () => Promise<string[]>,
  del: (name: string) => Promise<boolean>,
): CacheStorage {
  return {
    keys,
    delete: del,
    has: async () => false,
    match: async () => undefined,
    open: async () => ({}) as Cache,
  };
}

function stubCaches(names: string[]): { deleted: string[] } {
  const deleted: string[] = [];
  holder.caches = fakeCacheStorage(
    async () => names,
    async (name) => {
      deleted.push(name);
      return true;
    },
  );
  return { deleted };
}

afterEach(() => {
  delete holder.caches;
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
    delete holder.caches;
    await expect(clearDeviceCaches()).resolves.toBeUndefined();
  });

  it('swallows storage errors — sign-out must never strand the user', async () => {
    holder.caches = fakeCacheStorage(
      () => Promise.reject(new Error('QuotaExceededError')),
      async () => true,
    );
    await expect(clearDeviceCaches()).resolves.toBeUndefined();
  });
});
