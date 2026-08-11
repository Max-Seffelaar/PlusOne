/**
 * The door service worker is a plain file in `public/` — no bundler, no imports,
 * so nothing else in the suite can reach it. It is also the only place in the
 * app that writes user-visible HTML to disk, which makes a regex-over-source
 * "guard" far too weak: what matters is which cache a given request ENDS UP in.
 *
 * So this suite evaluates `public/service-worker.js` inside a fake ServiceWorker
 * global (self / caches / fetch / Response), fires actual fetch, activate and
 * message events at it, and asserts on the resulting Cache Storage contents.
 *
 * The property under test (86ey9e9mn): credentialed navigation HTML — `/app`
 * carries the RSC payload with user id, venue, roles, name — must land in the
 * session cache that sign-out wipes, never in the persistent shell cache, and
 * pages that are not needed for offline boot must not be stored at all. The
 * offline-boot cases are here for the same reason: privacy must not be bought
 * by quietly breaking invariant #25.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import { KEEP_PREFIX } from '@/features/door/offline/sw-cache';

const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

const SW_SOURCE = read('public/service-worker.js');
const STUB_SOURCE = read('public/sw.js');
const ORIGIN = 'https://app.plusone.test';

/** Derived from the source, never hardcoded: a rename that broke the
 *  `plusone-shell-` contract would otherwise sail past a suite that agreed with
 *  itself about the old names. The prefix contract is asserted separately. */
function constantFromSource(name: string): string {
  const match = new RegExp(`const ${name} = '([^']+)'`).exec(SW_SOURCE);
  if (!match) throw new Error(`${name} not found in public/service-worker.js`);
  return match[1];
}
const SHELL = constantFromSource('SHELL_CACHE');
const SESSION = constantFromSource('SESSION_CACHE');
const SHELL_MAX = Number(/const SHELL_MAX_ENTRIES = (\d+)/.exec(SW_SOURCE)?.[1]);

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

/** What a signed-out `/app` navigation actually looks like: navigations use
 *  redirect mode 'manual', so the middleware's 307 to /login arrives as an
 *  opaqueredirect — status 0, `redirected` false. */
const opaqueRedirect = (): FakeResponse =>
  makeResponse('login-307', { status: 0, type: 'opaqueredirect' });

const urlOf = (r: { url: string } | string): string =>
  typeof r === 'string' ? new URL(r, ORIGIN).href : r.url;
const stripSearch = (u: string): string => {
  const parsed = new URL(u);
  return parsed.origin + parsed.pathname;
};

class FakeCache {
  entries = new Map<string, FakeResponse>();
  async put(request: { url: string } | string, response: FakeResponse): Promise<void> {
    this.entries.set(urlOf(request), response);
  }
  async match(
    request: { url: string } | string,
    options?: { ignoreSearch?: boolean },
  ): Promise<FakeResponse | undefined> {
    const wanted = urlOf(request);
    const direct = this.entries.get(wanted);
    if (direct || !options?.ignoreSearch) return direct;
    for (const [key, value] of this.entries) {
      if (stripSearch(key) === stripSearch(wanted)) return value;
    }
    return undefined;
  }
  async keys(): Promise<{ url: string }[]> {
    return [...this.entries.keys()].map((url) => ({ url }));
  }
  async delete(request: { url: string } | string): Promise<boolean> {
    return this.entries.delete(urlOf(request));
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
  async match(
    request: { url: string } | string,
    options?: { ignoreSearch?: boolean },
  ): Promise<FakeResponse | undefined> {
    for (const bucket of this.buckets.values()) {
      const hit = await bucket.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  }
  /** Which cache names hold an entry for this URL — the actual assertion target. */
  bucketsHolding(url: string): string[] {
    return [...this.buckets.entries()].filter(([, c]) => c.entries.has(url)).map(([name]) => name);
  }
  countIn(name: string): number {
    return this.buckets.get(name)?.entries.size ?? 0;
  }
}

type Listener = (event: Record<string, unknown>) => void;
type OnlineFn = (input: string) => FakeResponse | Promise<FakeResponse> | null;

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function loadSw(
  options: { hostname?: string; online?: FakeResponse | null | OnlineFn } = {},
  source: string = SW_SOURCE,
) {
  const listeners = new Map<string, Listener>();
  const cacheStorage = new FakeCacheStorage();
  const navigated: string[] = [];
  const fetched: string[] = [];
  const fetchCalls: { url: string; credentials?: string }[] = [];
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
  const fetchImpl = async (
    input: { url: string } | string,
    init?: { credentials?: string },
  ): Promise<FakeResponse> => {
    const target = urlOf(input);
    fetched.push(target);
    fetchCalls.push({ url: target, credentials: init?.credentials });
    const resolved = typeof online === 'function' ? online(target) : online;
    if (!resolved) throw new TypeError('offline');
    return await resolved; // an OnlineFn may return a pending promise (race tests)
  };

  const ResponseStub = { error: () => makeResponse('network-error', { status: 0, type: 'error' }) };

  new Function('self', 'caches', 'fetch', 'Response', 'URL', source)(
    self,
    cacheStorage,
    fetchImpl,
    ResponseStub,
    URL,
  );

  async function fire(type: 'install' | 'activate'): Promise<void> {
    const pending: unknown[] = [];
    listeners.get(type)?.({ waitUntil: (p: unknown) => pending.push(p) });
    await Promise.allSettled(pending);
    await tick();
  }

  async function message(data: unknown): Promise<void> {
    const pending: unknown[] = [];
    listeners.get('message')?.({ data, waitUntil: (p: unknown) => pending.push(p) });
    await Promise.allSettled(pending);
    await tick();
  }

  /** Returns the response the SW served, or `undefined` if it did not intercept. */
  async function navigate(
    path: string,
    over: { mode?: string; method?: string; url?: string } = {},
  ): Promise<FakeResponse | undefined> {
    let served: Promise<FakeResponse> | undefined;
    const pending: unknown[] = [];
    const request = {
      url: over.url ?? new URL(path, ORIGIN).href,
      method: over.method ?? 'GET',
      mode: over.mode ?? 'navigate',
    };
    listeners.get('fetch')?.({
      request,
      respondWith: (p: Promise<FakeResponse>) => {
        served = p;
      },
      // `waitUntil` is how the SW keeps itself alive for a cache write that
      // outlives the response — it does NOT delay the response.
      waitUntil: (p: unknown) => pending.push(p),
    });
    const result = served ? await served : undefined;
    await Promise.allSettled(pending);
    await tick();
    return result;
  }

  return {
    cacheStorage,
    fire,
    message,
    navigate,
    navigated,
    fetched,
    fetchCalls,
    wasUnregistered: () => unregistered,
  };
}

/** A worker that has already been through install+activate. */
async function bootedSw(options: Parameters<typeof loadSw>[0] = {}) {
  const sw = loadSw(options);
  await sw.fire('install');
  await sw.fire('activate');
  return sw;
}

describe('door service worker — what may be written to disk', () => {
  let sw: Awaited<ReturnType<typeof bootedSw>>;

  beforeEach(async () => {
    sw = await bootedSw();
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

  it('does NOT treat a bare /door/ as a door page — it 308s to the picker', async () => {
    // Only Next's `trailingSlash: false` keeps the credentialed picker off this
    // path; the length check makes that independent of the framework setting.
    await sw.navigate('/door/');
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door/`)).not.toContain(SHELL);
  });

  it('keeps the static landing in the shell (installed PWA start_url)', async () => {
    await sw.navigate('/');
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/`)).toEqual([SHELL]);
  });

  it.each(['/login', '/e/summer-opening', '/onboarding', '/r/abc123'])(
    'never stores %s — not needed for offline boot',
    async (path) => {
      await sw.navigate(path);
      expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}${path}`)).toEqual([]);
    },
  );

  it('does not cache a signed-out /app navigation (arrives as an opaqueredirect)', async () => {
    const signedOut = await bootedSw({ online: opaqueRedirect });
    await signedOut.navigate('/app');
    expect(signedOut.cacheStorage.bucketsHolding(`${ORIGIN}/app`)).toEqual([]);
  });

  it('refuses a followed redirect on the static branch (redirect mode is "follow" there)', async () => {
    const redirected = await bootedSw({
      online: () => makeResponse('login-html', { redirected: true }),
    });
    await redirected.navigate('/_next/static/chunks/main.js', { mode: 'no-cors' });
    expect(redirected.cacheStorage.bucketsHolding(`${ORIGIN}/_next/static/chunks/main.js`)).toEqual([]);
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
  /** Warm one worker online, then hand its buckets to an offline one — same
   *  origin, same device, later launch. */
  async function warmThenOffline(warmPaths: string[]) {
    const warm = await bootedSw();
    for (const p of warmPaths) await warm.navigate(p);
    const offline = await bootedSw({ online: null });
    for (const [name, bucket] of warm.cacheStorage.buckets) {
      offline.cacheStorage.buckets.set(name, bucket);
    }
    return offline;
  }

  it('serves the cached /app shell on an offline cold start', async () => {
    const offline = await warmThenOffline(['/app']);
    expect((await offline.navigate('/app'))?.tag).toBe('network');
  });

  it('boots the installed PWA offline from its start_url', async () => {
    // manifest.json: start_url "/" with display standalone. Without this the
    // home-screen launch dead-ends on the browser's error page.
    const offline = await warmThenOffline(['/']);
    expect((await offline.navigate('/'))?.tag).toBe('network');
  });

  it('serves a cached shell across a query-string change (ignoreSearch)', async () => {
    // The Deur tab moves between sub-screens by query string only (doorPath()),
    // and the shell derives its screen client-side — same path is safe to serve.
    const offline = await warmThenOffline(['/app/door?event=X', '/app?x=1']);

    expect((await offline.navigate('/app/door?event=X&seg=taken'))?.tag).toBe('network');
    expect((await offline.navigate('/app/door'))?.tag).toBe('network');
    expect((await offline.navigate('/app'))?.tag).toBe('network');
  });

  it('still will not serve one path’s shell for another (ignoreSearch ignores only the query)', async () => {
    const offline = await warmThenOffline(['/app/door?event=X']);
    // /app is a different PATH: it falls back to a cached '/app', which we do
    // not have — an error is the correct answer, not the door tab's HTML.
    expect((await offline.navigate('/app'))?.type).toBe('error');
  });

  it('falls back to the cached /door picker for an uncached door deep link', async () => {
    const offline = await warmThenOffline(['/door']);
    expect((await offline.navigate('/door/never-visited'))?.tag).toBe('network');
  });

  it('never serves a door shell to an /app URL or vice versa (wrong-shell hazard)', async () => {
    const offline = await warmThenOffline(['/door']);
    expect((await offline.navigate('/app/events'))?.type).toBe('error');
  });

  it('never serves one event’s door page for another event', async () => {
    // The flight payload embeds the eventId, so a cross-event fallback would
    // render the wrong event's door.
    const offline = await warmThenOffline(['/door/event-a']);
    const served = await offline.navigate('/door/event-b');
    expect(served?.type).toBe('error');
  });
});

describe('door service worker — seeding the persistent shell', () => {
  it('caches /door/<eventId> on a seed-shell message', async () => {
    // Arriving from the picker is a <Link>/RSC fetch, never a 'navigate'
    // request, so without seeding a first-session tablet caches nothing.
    const sw = await bootedSw();
    await sw.message({ type: 'seed-shell', paths: ['/', '/door/evt-1'] });

    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door/evt-1`)).toEqual([SHELL]);
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/`)).toEqual([SHELL]);
  });

  it('refuses to seed a credentialed path, whatever the client asks for', async () => {
    const sw = await bootedSw();
    await sw.message({ type: 'seed-shell', paths: ['/app', '/door', '/login'] });

    expect(sw.cacheStorage.countIn(SHELL)).toBe(0);
    expect(sw.cacheStorage.countIn(SESSION)).toBe(0);
  });

  it('refuses cross-origin and non-string seed paths', async () => {
    const sw = await bootedSw();
    await sw.message({ type: 'seed-shell', paths: ['https://evil.test/door/x', 42, null] });

    expect(sw.fetched).toEqual([]);
  });

  it('does not re-fetch a path it already seeded in this worker instance', async () => {
    const sw = await bootedSw();
    await sw.message({ type: 'seed-shell', paths: ['/door/evt-1'] });
    await sw.message({ type: 'seed-shell', paths: ['/door/evt-1'] });

    expect(sw.fetched.filter((u) => u.endsWith('/door/evt-1'))).toHaveLength(1);
  });

  it('does not store a seed response that redirected to /login', async () => {
    const sw = await bootedSw({ online: () => makeResponse('login', { redirected: true }) });
    await sw.message({ type: 'seed-shell', paths: ['/door/evt-1'] });

    expect(sw.cacheStorage.countIn(SHELL)).toBe(0);
  });

  it('retries a path whose seed fetch failed', async () => {
    // Marking a path seeded before the fetch would strand the door with no
    // shell for the rest of the worker's life after one flaky request.
    let attempt = 0;
    const sw = await bootedSw({
      online: () => (++attempt === 1 ? null : makeResponse('door-html')),
    });

    await sw.message({ type: 'seed-shell', paths: ['/door/evt-1'] });
    expect(sw.cacheStorage.countIn(SHELL)).toBe(0);

    await sw.message({ type: 'seed-shell', paths: ['/door/evt-1'] });
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door/evt-1`)).toEqual([SHELL]);
  });

  it('seeds the landing anonymously and the door page with credentials', async () => {
    // Middleware 307s a signed-in user off `/` to `/app`, so a credentialed
    // seed would never store the PWA's start_url and the offline launch would
    // stay broken for exactly the people who use the installed app. The door
    // page is the opposite — without the session it 404s.
    const sw = await bootedSw();

    await sw.message({ type: 'seed-shell', paths: ['/', '/door/evt-1'] });

    expect(sw.fetchCalls).toEqual([
      { url: `${ORIGIN}/`, credentials: 'omit' },
      { url: `${ORIGIN}/door/evt-1`, credentials: 'same-origin' },
    ]);
  });
});

describe('door service worker — session-cache lifetime', () => {
  it('drops a write whose sign-out landed while the response was in flight', async () => {
    // The Cache Storage counterpart of idbEpoch(): a sibling tab's in-flight
    // navigation must not resurrect the cache clearDeviceCaches() just deleted.
    let release: (r: FakeResponse) => void = () => {};
    const inFlight = new Promise<FakeResponse>((r) => {
      release = r;
    });
    const sw = await bootedSw({ online: () => inFlight });

    const navigation = sw.navigate('/app'); // fetch starts, captures the epoch
    await sw.message({ type: 'session-wipe' }); // sign-out lands mid-flight
    release(makeResponse('late-app-html')); // …and only now does /app answer
    await navigation;

    expect(sw.cacheStorage.buckets.has(SESSION)).toBe(false);
  });

  it('caches normally again for the next user (the epoch self-heals)', async () => {
    const sw = await bootedSw();
    await sw.message({ type: 'session-wipe' });

    await sw.navigate('/app'); // a navigation STARTED after the wipe

    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/app`)).toEqual([SESSION]);
  });

  it('deletes the session cache on a session-wipe message', async () => {
    const sw = await bootedSw();
    await sw.navigate('/app');
    expect(sw.cacheStorage.countIn(SESSION)).toBe(1);

    await sw.message({ type: 'session-wipe' });

    expect(sw.cacheStorage.buckets.has(SESSION)).toBe(false);
  });

  it('keeps the persistent shell on a session-wipe message', async () => {
    const sw = await bootedSw();
    await sw.navigate('/door/evt-1');

    await sw.message({ type: 'session-wipe' });

    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/door/evt-1`)).toEqual([SHELL]);
  });

  it('self-cleans after a remote revoke: an opaqueredirect on /app drops the session cache', async () => {
    // Nothing runs on a remotely revoked device, so the wipe has to happen the
    // next time it comes online — the 307 to /login is the signal.
    const sw = await bootedSw();
    await sw.navigate('/app');
    expect(sw.cacheStorage.countIn(SESSION)).toBe(1);

    const revoked = loadSw({ online: opaqueRedirect });
    await revoked.fire('install');
    await revoked.fire('activate');
    revoked.cacheStorage.buckets.set(SESSION, sw.cacheStorage.buckets.get(SESSION)!);

    await revoked.navigate('/app');

    expect(revoked.cacheStorage.buckets.has(SESSION)).toBe(false);
  });

  it('does not drop the session cache on a server error (only on a redirect)', async () => {
    const sw = await bootedSw();
    await sw.navigate('/app');

    const erroring = loadSw({ online: () => makeResponse('502', { status: 502 }) });
    await erroring.fire('install');
    await erroring.fire('activate');
    erroring.cacheStorage.buckets.set(SESSION, sw.cacheStorage.buckets.get(SESSION)!);

    await erroring.navigate('/app');

    expect(erroring.cacheStorage.buckets.has(SESSION)).toBe(true);
  });
});

describe('door service worker — cache hygiene', () => {
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

  it('claims its clients even when a cache delete rejects', async () => {
    // activate never fires again for this script version — one bad delete must
    // not leave the worker permanently unclaimed.
    const sw = loadSw();
    await sw.fire('install');
    await sw.cacheStorage.open('plusone-door-v1');
    sw.cacheStorage.delete = async () => {
      throw new Error('storage error');
    };

    await expect(sw.fire('activate')).resolves.toBeUndefined();
  });

  it('bounds the shell cache so origin eviction never takes the outbox with it', async () => {
    const sw = await bootedSw();
    await sw.navigate('/'); // a navigation shell — must survive the trim
    for (let i = 0; i < SHELL_MAX + 1; i++) {
      await sw.navigate(`/_next/static/chunks/${i}.js`, { mode: 'no-cors' });
    }

    expect(sw.cacheStorage.countIn(SHELL)).toBeLessThanOrEqual(SHELL_MAX);
    expect(sw.cacheStorage.bucketsHolding(`${ORIGIN}/`)).toEqual([SHELL]);
  });

  it('is inert on localhost (dev kill-switch)', async () => {
    const dev = loadSw({ hostname: 'localhost' });
    await dev.fire('install');
    await dev.cacheStorage.open(SHELL);
    await dev.fire('activate');

    expect(await dev.cacheStorage.keys()).toEqual([]);
    expect(dev.wasUnregistered()).toBe(true);
    expect(await dev.navigate('/app')).toBeUndefined();
    await dev.message({ type: 'seed-shell', paths: ['/door/evt-1'] });
    expect(dev.fetched).toEqual([]);
  });
});

describe('cache-name contract (drift guard)', () => {
  it('keeps SHELL_CACHE under the prefix sign-out spares, and SESSION_CACHE out of it', () => {
    // A rename that broke this would make clearDeviceCaches() wipe the offline
    // shell (breaking #25) or spare the credentialed cache (re-opening the PII
    // hole) — with every behavioural test still green.
    expect(SHELL.startsWith(KEEP_PREFIX)).toBe(true);
    expect(SESSION.startsWith(KEEP_PREFIX)).toBe(false);
  });

  it('uses the same prefix in the self-destructing /sw.js stub', () => {
    expect(STUB_SOURCE).toContain(KEEP_PREFIX);
  });
});

describe('persistent-shell PII contract', () => {
  it('the door page renders only <DoorRoute> — no server-serialized guest data', () => {
    // This is what makes /door/<eventId> safe to keep across sign-out. If the
    // page ever SSRs event names, guests or memberships, the persistent cache
    // becomes a PII store on a shared tablet.
    const src = read('src/app/door/[eventId]/page.tsx');
    const returned = /return\s+(<[\s\S]*?\/>)\s*;/.exec(src)?.[1] ?? '';

    expect(returned.startsWith('<DoorRoute')).toBe(true);
    const props = [...returned.matchAll(/(\w+)=\{/g)].map((m) => m[1]);
    expect(new Set(props)).toEqual(new Set(['eventId', 'serverHint']));
    expect(src).not.toMatch(/\.from\(['"]guests['"]\)/);
  });

  it('documents the /_next/image caveat while that path routes to the shell', () => {
    // `/_next/image` matches STATIC_RE and therefore lands in the persistent
    // cache; that is only safe while the optimizer is off.
    expect(SW_SOURCE).toContain('/_next/image');
    expect(read('next.config.js')).toMatch(/unoptimized:\s*true/);
  });
});
