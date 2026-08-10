/**
 * The door service worker is a plain file in `public/` — no bundler, no imports,
 * so nothing else in the suite can reach it. It is also the only place in the
 * app that writes user-visible HTML to disk, which makes a regex-over-source
 * "guard" far too weak: what matters is which cache a given request ENDS UP in.
 *
 * So this suite evaluates `public/service-worker.js` inside a fake ServiceWorker
 * global (self / caches / fetch / Response), fires real fetch + activate events
 * at it, and asserts on the resulting Cache Storage contents.
 *
 * The property under test (86ey9e9mn): credentialed navigation HTML — `/app`
 * carries the RSC payload with user id, venue, roles, name — must land in the
 * session cache that sign-out wipes, never in the persistent shell cache, and
 * pages that are not needed for offline boot must not be stored at all.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8');
const ORIGIN = 'https://app.plusone.test';

const SHELL = 'plusone-shell-v2';
const SESSION = 'plusone-session-v1';

type FakeResponse = {
  status: number;
  type: string;
  redirected: boolean;
  tag: string;
  clone: () => FakeResponse;
};

function makeResponse(tag: string, over: Partial<FakeResponse> = {}): FakeResponse {
  const res: FakeResponse = {
    status: 200,
    type: 'basic',
    redirected: false,
    tag,
    clone: () => res,
    ...over,
  };
  res.clone = () => res;
  return res;
}

class FakeCache {
  entries = new Map<string, FakeResponse>();
  async put(request: { url: string } | string, response: FakeResponse): Promise<void> {
    this.entries.set(typeof request === 'string' ? `${ORIGIN}${request}` : request.url, response);
  }
  async match(request: { url: string } | string): Promise<FakeResponse | undefined> {
    return this.entries.get(typeof request === 'string' ? `${ORIGIN}${request}` : request.url);
  }
}

class FakeCacheStorage {
  buckets = new Map<string, FakeCache>();
  async open(name: string): Promise<FakeCache> {
    const existing = this.buckets.get(name);
    if (existing) return existing;
    const created = new FakeCache();
    this.buckets.set(name, created);
    return created;
  }
  async keys(): Promise<string[]> {
    return [...this.buckets.keys()];
  }
  async delete(name: string): Promise<boolean> {
    return this.buckets.delete(name);
  }
  async match(request: { url: string } | string): Promise<FakeResponse | undefined> {
    for (const bucket of this.buckets.values()) {
      const hit = await bucket.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Which cache names hold an entry for this URL — the actual assertion target. */
  bucketsHolding(url: string): string[] {
    return [...this.buckets.entries()].filter(([, c]) => c.entries.has(url)).map(([name]) => name);
  }
}

type Listener = (event: Record<string, unknown>) => void;

function loadSw(options: { hostname?: string; online?: FakeResponse | null } = {}) {
  const listeners = new Map<string, Listener>();
  const cacheStorage = new FakeCacheStorage();
  const navigated: string[] = [];
  let unregistered = false;

  const self = {
    location: { hostname: options.hostname ?? 'app.plusone.test', origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: async () => undefined,
    registration: {
      unregister: async () => {
        unregistered = true;
        return true;
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ url: `${ORIGIN}/app`, navigate: (u: string) => navigated.push(u) }],
    },
  };

  const online = options.online === undefined ? makeResponse('network') : options.online;
  const fetchImpl = async (): Promise<FakeResponse> => {
    if (!online) throw new TypeError('offline');
    return online;
  };

  const ResponseStub = { error: () => makeResponse('network-error', { status: 0, type: 'error' }) };

  new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SOURCE)(
    self,
    cacheStorage,
    fetchImpl,
    ResponseStub,
    URL,
  );

  async function fire(type: 'install' | 'activate'): Promise<void> {
    const pending: unknown[] = [];
    listeners.get(type)?.({ waitUntil: (p: unknown) => pending.push(p) });
    await Promise.all(pending);
  }

  /** Returns the response the SW served, or `undefined` if it did not intercept. */
  async function navigate(
    path: string,
    over: { mode?: string; method?: string; url?: string } = {},
  ): Promise<FakeResponse | undefined> {
    let served: Promise<FakeResponse> | undefined;
    const request = {
      url: over.url ?? `${ORIGIN}${path}`,
      method: over.method ?? 'GET',
      mode: over.mode ?? 'navigate',
    };
    listeners.get('fetch')?.({
      request,
      respondWith: (p: Promise<FakeResponse>) => {
        served = p;
      },
    });
    const result = served ? await served : undefined;
    // `putInCache` is fire-and-forget (the SW must not delay the response on a
    // cache write), so let its promise chain settle before anyone asserts.
    await new Promise((r) => setTimeout(r, 0));
    return result;
  }

  return { cacheStorage, fire, navigate, navigated, wasUnregistered: () => unregistered };
}

describe('door service worker — what may be written to disk', () => {
  let sw: ReturnType<typeof loadSw>;

  beforeEach(async () => {
    sw = loadSw();
    await sw.fire('install');
    await sw.fire('activate');
  });

  it('keeps credentialed /app HTML out of the persistent shell cache', async () => {
    await sw.navigate('/app');
    // /app SSRs the RSC payload (user id, venue, roles, display name) — it may be
    // cached for offline boot, but only in the bucket sign-out wipes.
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/app`)).toEqual([SESSION]);
  });

  it('routes deep /app screens to the session cache too', async () => {
    await sw.navigate('/app/guests/list');
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/app/guests/list`)).toEqual([SESSION]);
  });

  it('keeps the PII-free /door/<eventId> shell persistent (invariant #25)', async () => {
    await sw.navigate('/door/3f2a1c8e-0000-7000-8000-000000000001');
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door/3f2a1c8e-0000-7000-8000-000000000001`)).toEqual([
      SHELL,
    ]);
  });

  it('treats the /door picker as session data (it SSRs the caller’s events)', async () => {
    await sw.navigate('/door');
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door`)).toEqual([SESSION]);
  });

  it.each(['/login', '/e/summer-opening', '/onboarding', '/r/abc123', '/'])(
    'never stores %s — not needed for offline boot',
    async (path) => {
      await sw.navigate(path);
      expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}${path}`)).toEqual([]);
    },
  );

  it('does not cache a redirected navigation (signed-out /app → /login)', async () => {
    const redirected = loadSw({ online: makeResponse('login-html', { redirected: true }) });
    await redirected.fire('activate');
    await redirected.navigate('/app');
    expect(redirected.cacheStorage.bucketsHolding(`${ORIGIN}/app`)).toEqual([]);
  });

  it('does not intercept cross-origin requests (Supabase REST/Realtime)', async () => {
    const served = await sw.navigate('/rest/v1/guests', {
      url: 'https://tolxwgqhppdcvnogdpel.supabase.co/rest/v1/guests',
      mode: 'cors',
    });
    expect(served).toBeUndefined();
    expect(sw.cacheStorage.buckets.size).toBe(0);
  });

  it('does not intercept non-GET requests', async () => {
    const served = await sw.navigate('/app', { method: 'POST' });
    expect(served).toBeUndefined();
  });

  it('puts static assets in the shell cache', async () => {
    await sw.navigate('/_next/static/chunks/main.js', { mode: 'no-cors' });
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/_next/static/chunks/main.js`)).toEqual([SHELL]);
  });
});

describe('door service worker — offline behaviour must not regress', () => {
  it('serves the cached /app shell on an offline cold start', async () => {
    const warm = loadSw();
    await warm.fire('activate');
    await warm.navigate('/app'); // online visit fills the session cache

    const offline = loadSw({ online: null });
    await offline.fire('activate');
    // Re-use the warm cache contents: same origin, same device.
    offline.cacheStorage.buckets.set(SESSION, warm.cacheStorage.buckets.get(SESSION)!);

    const served = await offline.navigate('/app');
    expect(served?.tag).toBe('network');
  });

  it('falls back to the cached /door shell for an uncached door deep link', async () => {
    const warm = loadSw();
    await warm.fire('activate');
    await warm.navigate('/door');

    const offline = loadSw({ online: null });
    await offline.fire('activate');
    offline.cacheStorage.buckets.set(SESSION, warm.cacheStorage.buckets.get(SESSION)!);

    const served = await offline.navigate('/door/never-visited');
    expect(served?.tag).toBe('network'); // the cached /door shell, not an error
  });

  it('never serves a door shell to an /app URL or vice versa (wrong-shell hazard)', async () => {
    const warm = loadSw();
    await warm.fire('activate');
    await warm.navigate('/door');

    const offline = loadSw({ online: null });
    await offline.fire('activate');
    offline.cacheStorage.buckets.set(SESSION, warm.cacheStorage.buckets.get(SESSION)!);

    const served = await offline.navigate('/app/events');
    expect(served?.type).toBe('error');
  });
});

describe('door service worker — cache migration', () => {
  it('purges the pre-fix cache that holds leaked /app HTML', async () => {
    const sw = loadSw();
    await sw.fire('install');
    // A device that already ran the old SW: one cache, credentialed HTML inside.
    const legacy = await sw.cacheStorage.open('plusone-door-v1');
    await legacy.put({ url: `${ORIGIN}/app` }, makeResponse('leaked-app-html'));
    await sw.cacheStorage.open('workbox-precache-v2');

    await sw.fire('activate');

    expect(await sw.cacheStorage.keys()).toEqual([]);
  });

  it('is inert on localhost (dev kill-switch)', async () => {
    const dev = loadSw({ hostname: 'localhost' });
    await dev.fire('install');
    await dev.cacheStorage.open('plusone-shell-v2');
    await dev.fire('activate');

    expect(await dev.cacheStorage.keys()).toEqual([]);
    expect(dev.wasUnregistered()).toBe(true);
    const served = await dev.navigate('/app');
    expect(served).toBeUndefined();
  });
});
