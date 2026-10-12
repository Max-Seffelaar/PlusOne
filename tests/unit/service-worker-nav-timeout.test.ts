/**
 * Perf audit finding 11: network-first navigations race a timeout, then fall
 * back to the cache the offline path already uses. Runs the real
 * `public/service-worker.js` in a fake ServiceWorker global (same approach as
 * service-worker-cache-scope.test.ts, which stays the guard for WHERE things
 * are cached) with fake timers, so "slow" is exact.
 *
 * What must hold: the PII buckets are unchanged — a late response is written
 * under its own URL into the bucket it always went to, never under the
 * fallback's URL; a late 307 → /login (opaqueredirect) still wipes the session
 * cache; a sign-out during the flight still drops the late write; and with
 * nothing cached, a slow network is waited for, never turned into an error.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SW_SOURCE = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8');
const ORIGIN = 'https://app.plusone.test';
const constant = (name: string): string => {
  const m = new RegExp(`const ${name} = '([^']+)'`).exec(SW_SOURCE);
  if (!m) throw new Error(`${name} not found`);
  return m[1];
};
const SHELL = constant('SHELL_CACHE');
const SESSION = constant('SESSION_CACHE');
const TIMEOUT = Number(/const NAV_TIMEOUT_MS = (\d+)/.exec(SW_SOURCE)?.[1]);

type Res = { status: number; type: string; redirected: boolean; tag: string; clone: () => Res };
const res = (tag: string, over: Partial<Res> = {}): Res => {
  const r: Res = { status: 200, type: 'basic', redirected: false, tag, clone: () => r, ...over };
  r.clone = () => r;
  return r;
};
const href = (r: { url: string } | string): string => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url);
const bare = (u: string): string => {
  const p = new URL(u);
  return p.origin + p.pathname;
};

class Cache {
  entries = new Map<string, Res>();
  async put(req: { url: string } | string, r: Res) {
    this.entries.set(href(req), r);
  }
  async match(req: { url: string } | string, o?: { ignoreSearch?: boolean }) {
    const want = href(req);
    const hit = this.entries.get(want);
    if (hit || !o?.ignoreSearch) return hit;
    for (const [k, v] of this.entries) if (bare(k) === bare(want)) return v;
    return undefined;
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(req: { url: string } | string) {
    return this.entries.delete(href(req));
  }
}

class Storage {
  buckets = new Map<string, Cache>();
  async open(n: string) {
    if (!this.buckets.has(n)) this.buckets.set(n, new Cache());
    return this.buckets.get(n)!;
  }
  async keys() {
    return [...this.buckets.keys()];
  }
  async delete(n: string) {
    return this.buckets.delete(n);
  }
  async match(req: { url: string } | string, o?: { ignoreSearch?: boolean }) {
    for (const b of this.buckets.values()) {
      const hit = await b.match(req, o);
      if (hit) return hit;
    }
    return undefined;
  }
  get(name: string, path: string): Res | undefined {
    return this.buckets.get(name)?.entries.get(new URL(path, ORIGIN).href);
  }
  holding(path: string): string[] {
    const u = new URL(path, ORIGIN).href;
    return [...this.buckets].filter(([, c]) => c.entries.has(u)).map(([n]) => n);
  }
}

type Deferred = { promise: Promise<Res>; resolve: (r: Res) => void; reject: (e: unknown) => void };
const deferred = (): Deferred => {
  let resolveFn!: (r: Res) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<Res>((a, b) => {
    resolveFn = a;
    rejectFn = b;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
};

function loadSw() {
  const listeners = new Map<string, (e: Record<string, unknown>) => void>();
  const storage = new Storage();
  // Per-URL network: a Deferred the test settles when it wants; default instant.
  const network = new Map<string, Deferred>();
  const self = {
    location: { hostname: 'app.plusone.test', origin: ORIGIN, search: '' },
    addEventListener: (t: string, fn: (e: Record<string, unknown>) => void) => listeners.set(t, fn),
    skipWaiting: async () => undefined,
    registration: { unregister: async () => true },
    clients: { claim: async () => undefined, matchAll: async () => [] },
  };
  const fetchImpl = async (input: { url: string } | string): Promise<Res> => {
    const d = network.get(bare(href(input)));
    return d ? d.promise : res(`net:${new URL(href(input)).pathname}`);
  };
  const ResponseStub = {
    error: () => res('network-error', { status: 0, type: 'error' }),
    redirect: (u: string, status = 302) => res(`redirect:${u}`, { status }),
  };
  new Function('self', 'caches', 'fetch', 'Response', 'URL', SW_SOURCE)(self, storage, fetchImpl, ResponseStub, URL);

  /** Fire a navigation; returns the served promise + a flag that flips when it settles. */
  function navigate(path: string) {
    let served!: Promise<Res>;
    const state = { settled: false, value: undefined as Res | undefined };
    listeners.get('fetch')!({
      request: { url: new URL(path, ORIGIN).href, method: 'GET', mode: 'navigate' },
      respondWith: (p: Promise<Res>) => {
        served = p;
      },
      waitUntil: () => undefined,
    });
    served.then((v) => {
      state.settled = true;
      state.value = v;
    });
    return state;
  }
  function message(data: unknown) {
    listeners.get('message')!({ data, waitUntil: () => undefined });
  }
  function slow(path: string): Deferred {
    const d = deferred();
    network.set(new URL(path, ORIGIN).href, d);
    return d;
  }
  return { storage, navigate, message, slow, network };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

async function swWithCached(paths: string[]) {
  const sw = loadSw();
  for (const p of paths) {
    sw.navigate(p);
    await flush();
  }
  return sw;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('service worker — navigation timeout (finding 11)', () => {
  it('times out in the 3–4 s window the audit asks for', () => {
    expect(TIMEOUT).toBeGreaterThanOrEqual(3000);
    expect(TIMEOUT).toBeLessThanOrEqual(4000);
  });

  it('lie-fi with a cached /app → the cached shell at the timeout, not before', async () => {
    const sw = await swWithCached(['/app']);
    sw.slow('/app');
    const nav = sw.navigate('/app');
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(nav.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(nav.value?.tag).toBe('net:/app'); // the response cached on the first visit
  });

  it('deep /app link on lie-fi → the /app fallback shell', async () => {
    const sw = await swWithCached(['/app']);
    sw.slow('/app/guests');
    const nav = sw.navigate('/app/guests');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nav.value?.tag).toBe('net:/app');
  });

  it('nothing cached → keeps waiting for the network instead of an error page', async () => {
    const sw = loadSw();
    const d = sw.slow('/app');
    const nav = sw.navigate('/app');
    await vi.advanceTimersByTimeAsync(TIMEOUT * 3);
    expect(nav.settled).toBe(false);
    d.resolve(res('late-app'));
    await flush();
    expect(nav.value?.tag).toBe('late-app');
    expect(sw.storage.holding('/app')).toEqual([SESSION]);
  });

  it('fast network → the network response, cache untouched by the timer', async () => {
    const sw = await swWithCached(['/app']);
    sw.network.clear();
    const nav = sw.navigate('/app');
    await flush();
    expect(nav.value?.tag).toBe('net:/app');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('network error before the timeout → the same cache fallback as offline', async () => {
    const sw = await swWithCached(['/app']);
    const d = sw.slow('/app/events');
    const nav = sw.navigate('/app/events');
    d.reject(new TypeError('offline'));
    await flush();
    expect(nav.value?.tag).toBe('net:/app');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('network error after the timeout found nothing → Response.error()', async () => {
    const sw = loadSw();
    const d = sw.slow('/app');
    const nav = sw.navigate('/app');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    d.reject(new TypeError('offline'));
    await flush();
    expect(nav.value?.type).toBe('error');
  });

  it('a late success is cached under ITS OWN URL — never over the fallback it raced', async () => {
    const sw = await swWithCached(['/app']);
    const d = sw.slow('/app/guests');
    const nav = sw.navigate('/app/guests');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nav.value?.tag).toBe('net:/app');
    d.resolve(res('late-guests'));
    await flush();
    expect(sw.storage.get(SESSION, '/app/guests')?.tag).toBe('late-guests');
    expect(sw.storage.get(SESSION, '/app')?.tag).toBe('net:/app');
    expect(sw.storage.holding('/app/guests')).toEqual([SESSION]);
  });

  it('a late door page lands in the persistent shell only (PII-free bucket unchanged)', async () => {
    const sw = await swWithCached(['/door']);
    const d = sw.slow('/door/e1');
    sw.navigate('/door/e1');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    d.resolve(res('late-door'));
    await flush();
    expect(sw.storage.holding('/door/e1')).toEqual([SHELL]);
  });

  it('a late 307 → /login (opaqueredirect) still wipes the session cache', async () => {
    const sw = await swWithCached(['/app', '/app/events']);
    const d = sw.slow('/app');
    const nav = sw.navigate('/app');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nav.value?.tag).toBe('net:/app');
    d.resolve(res('login-307', { status: 0, type: 'opaqueredirect' }));
    await flush();
    expect(sw.storage.buckets.has(SESSION)).toBe(false);
  });

  it('a sign-out while the slow response is in flight drops its late write', async () => {
    const sw = await swWithCached(['/app']);
    const d = sw.slow('/app/guests');
    sw.navigate('/app/guests');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    sw.message({ type: 'session-wipe' });
    await flush();
    d.resolve(res('late-guests'));
    await flush();
    expect(sw.storage.get(SESSION, '/app/guests')).toBeUndefined();
  });

  it('a non-cached route (/login) on lie-fi is waited for and never stored', async () => {
    const sw = loadSw();
    const d = sw.slow('/login');
    const nav = sw.navigate('/login');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nav.settled).toBe(false);
    d.resolve(res('login'));
    await flush();
    expect(nav.value?.tag).toBe('login');
    expect(sw.storage.holding('/login')).toEqual([]);
  });

  it('/ on lie-fi with a signed-in /app shell → the Deur tab, as offline', async () => {
    const sw = await swWithCached(['/app']);
    sw.slow('/');
    const nav = sw.navigate('/');
    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(nav.value?.tag).toBe(`redirect:${ORIGIN}/app/door`);
  });
});
