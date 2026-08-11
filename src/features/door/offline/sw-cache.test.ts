import { describe, it, expect, afterEach, vi } from 'vitest';
import { clearDeviceCaches, KEEP_PREFIX } from './sw-cache';

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
  vi.unstubAllGlobals();
});

/** Stub just enough of `navigator.serviceWorker` to observe the wipe message. */
function stubServiceWorker(): { posted: unknown[] } {
  const posted: unknown[] = [];
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({ active: { postMessage: (m: unknown) => posted.push(m) } }),
      controller: null,
    },
  });
  return { posted };
}

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

  it('tells the service worker a wipe happened (re-population guard)', async () => {
    // Without this the SW has no idea: a sibling tab's in-flight navigation
    // response would re-create the session cache we just deleted. The worker
    // bumps its epoch on this message and drops any write from before it —
    // the Cache Storage counterpart of `idbEpoch()`.
    const { posted } = stubServiceWorker();
    stubCaches(['plusone-session-v1']);

    await clearDeviceCaches();

    expect(posted).toEqual([{ type: 'session-wipe' }]);
  });

  it('still notifies the worker when CacheStorage itself is missing', async () => {
    const { posted } = stubServiceWorker();
    delete holder.caches;

    await clearDeviceCaches();

    expect(posted).toEqual([{ type: 'session-wipe' }]);
  });

  it('exports the prefix the service workers must agree on', () => {
    // Guarded end-to-end in tests/unit/service-worker-cache-scope.test.ts; this
    // just pins that the constant is exported rather than re-typed per file.
    expect(KEEP_PREFIX).toBe('plusone-shell-');
  });
});
