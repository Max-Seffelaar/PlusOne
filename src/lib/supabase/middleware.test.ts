import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// updateSession's review-demo branch (86ey6bfug): a demo-account session
// outside its review window is signed out globally and sent to /login on every
// route the middleware covers. Everyone else, and the demo account inside the
// window, goes through exactly as before. @supabase/ssr is stubbed; signOut
// clears the auth cookie through setAll, as the real SSR client does.
const getUser = vi.fn();
const signOut = vi.fn();
let setAll: ((c: { name: string; value: string; options?: Record<string, unknown> }[]) => void) | null = null;

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: typeof setAll } }) => {
    setAll = opts.cookies.setAll;
    return { auth: { getUser, signOut } };
  },
}));

const ORIGIN = 'http://localhost:3000';
const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function run(path = '/door/e1', init?: ConstructorParameters<typeof NextRequest>[1]) {
  const { updateSession } = await import('./middleware');
  return updateSession(
    new NextRequest(`${ORIGIN}${path}`, {
      ...init,
      headers: { cookie: 'sb-local-auth-token=abc', ...(init?.headers as Record<string, string> | undefined) },
    })
  );
}

function openWindow(): void {
  vi.stubEnv('REVIEW_LOGIN_CODE', 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk');
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:55321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
  vi.stubEnv('REVIEW_LOGIN_CODE', '');
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', '');
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  signOut.mockImplementation(async () => {
    setAll?.([{ name: 'sb-local-auth-token', value: '', options: { maxAge: 0, path: '/' } }]);
    return { error: null };
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('updateSession — review demo account', () => {
  it.each([
    ['id and e-mail', DEMO],
    ['id with a rebound e-mail', { ...DEMO, email: 'rebound@attacker.example' }],
    ['e-mail on another id', { ...DEMO, id: 'other-id' }],
  ])('demo (%s) + closed window → global sign-out, 303 /login, auth cookie cleared', async (_l, user) => {
    getUser.mockResolvedValue({ data: { user } });
    const res = await run('/door/e1');
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(res.demoSessionEnded).toBe(true);
    expect(res.user).toBeNull();
    expect(res.response.status).toBe(303);
    expect(new URL(res.response.headers.get('location')!).pathname).toBe('/login');
    expect(res.response.headers.get('cache-control')).toContain('no-store');
    const cleared = res.response.cookies.get('sb-local-auth-token');
    expect(cleared?.value).toBe('');
    expect(cleared?.maxAge).toBe(0);
  });

  it('also on a server-action POST (303 turns it into a GET of /login)', async () => {
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await run('/app', { method: 'POST', headers: { 'next-action': 'abc' } });
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(res.response.status).toBe(303);
  });

  it('demo + OPEN window → untouched: no sign-out, pass-through response, user kept', async () => {
    openWindow();
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await run('/door/e1');
    expect(signOut).not.toHaveBeenCalled();
    expect(res.demoSessionEnded).toBeUndefined();
    expect(res.user).toEqual(DEMO);
    expect(res.response.headers.get('location')).toBeNull();
  });

  it('any other user → unchanged, window open or closed', async () => {
    const other = { id: 'u-1', email: 'max@venue.com' };
    getUser.mockResolvedValue({ data: { user: other } });
    for (const arrange of [() => undefined, openWindow]) {
      arrange();
      const res = await run('/app');
      expect(signOut).not.toHaveBeenCalled();
      expect(res.demoSessionEnded).toBeUndefined();
      expect(res.user).toEqual(other);
      expect(res.response.headers.get('location')).toBeNull();
    }
  });

  it('no session → unchanged', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await run('/api/webhooks/stripe', { method: 'POST' });
    expect(signOut).not.toHaveBeenCalled();
    expect(res.demoSessionEnded).toBeUndefined();
    expect(res.response.headers.get('location')).toBeNull();
  });

  it.each([
    ['returns an error', () => signOut.mockResolvedValue({ error: { message: 'boom' } })],
    ['throws', () => signOut.mockRejectedValue(new Error('lock'))],
  ])('sign-out %s → 503, not a redirect (a redirect to /login would loop)', async (_l, arrange) => {
    arrange();
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await run('/app');
    expect(res.demoSessionEnded).toBe(true);
    expect(res.response.status).toBe(503);
    expect(res.response.headers.get('location')).toBeNull();
  });
});
