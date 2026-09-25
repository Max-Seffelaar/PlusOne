import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The route with Supabase mocked out:
//  - the service client (generateLink, the one service-role call);
//  - the cookie-LESS probe client (verifyOtp + every fail-closed check + the
//    revocation of other sessions), built by createReviewAuthClient;
//  - the cookie client, which only ever receives setSession after the checks.
const generateLink = vi.fn();
const verifyOtp = vi.fn();
const listFactors = vi.fn();
const probeSignOut = vi.fn();
const rpc = vi.fn();
const setSession = vi.fn();

const DEMO_VENUE_ID = 'de300000-0000-7000-8000-000000000001';
const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };
const SESSION = { access_token: 'at', refresh_token: 'rt' };

// Table state the probe's queries resolve against (RLS as the demo user).
let ownMemberships: unknown[];
let venueMembers: unknown[];
let venueInvites: unknown[];
let addressedInvites: unknown[];
let failTable: string | null;

function query(table: string) {
  const filters: Record<string, unknown> = {};
  const q = {
    select: () => q,
    eq: (col: string, val: unknown) => ((filters[col] = val), q),
    ilike: (col: string, val: unknown) => ((filters[`ilike:${col}`] = val), q),
    is: () => q,
    gt: () => q,
    then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(resolveQuery(table, filters)).then(res, rej),
  };
  return q;
}

function resolveQuery(table: string, filters: Record<string, unknown>) {
  if (failTable === table) return { data: null, error: { message: 'boom' } };
  if (table === 'venue_memberships') {
    return { data: 'user_id' in filters ? ownMemberships : venueMembers, error: null };
  }
  if (table === 'invites') {
    return { data: 'venue_id' in filters ? venueInvites : addressedInvites, error: null };
  }
  throw new Error(`unexpected table ${table}`);
}

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { setSession } }),
}));
vi.mock('@/features/auth/review-login', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/auth/review-login')>()),
  createReviewAuthClient: () => ({
    auth: { verifyOtp, mfa: { listFactors }, signOut: probeSignOut },
    rpc,
    from: (table: string) => query(table),
  }),
}));
vi.mock('@/features/auth/entry-redirect', () => ({
  resolveEntryDestination: async (_userId: string, next: string) => next,
}));

const CODE = 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk';
const ORIGIN = 'http://localhost:3000';
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

async function route() {
  return import('./route');
}

async function post(body: string | null, opts: { origin?: string | null; ip?: string } = {}) {
  const headers = new Headers({ 'content-type': 'application/x-www-form-urlencoded' });
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN);
  headers.set('x-forwarded-for', opts.ip ?? freshIp());
  const { POST } = await route();
  return POST(new NextRequest(`${ORIGIN}/auth/review-login`, { method: 'POST', headers, body: body ?? undefined }));
}

const form = (code: string) => `code=${encodeURIComponent(code)}`;

function location(res: Response): URL {
  return new URL(res.headers.get('location')!);
}

beforeEach(() => {
  vi.resetModules(); // a fresh per-instance limiter for every test
  vi.clearAllMocks();
  vi.stubEnv('REVIEW_LOGIN_CODE', CODE);
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'th' } }, error: null });
  verifyOtp.mockResolvedValue({ data: { user: DEMO, session: SESSION }, error: null });
  listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  probeSignOut.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: false, error: null });
  setSession.mockResolvedValue({ data: {}, error: null });
  ownMemberships = [{ venue_id: DEMO_VENUE_ID, roles: ['admin', 'doorhost'] }];
  venueMembers = [{ user_id: DEMO.id }];
  venueInvites = [];
  addressedInvites = [];
  failTable = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('disabled (window closed) → 404, no hint', () => {
  it.each([
    ['code unset', { REVIEW_LOGIN_CODE: undefined }],
    ['code empty', { REVIEW_LOGIN_CODE: '' }],
    ['code whitespace', { REVIEW_LOGIN_CODE: '   ' }],
    ['code too short', { REVIEW_LOGIN_CODE: 'k7p2-x9qm-4hzt-8wva' }],
    ['expiry unset', { REVIEW_LOGIN_EXPIRES_AT: undefined }],
    ['expiry unparseable', { REVIEW_LOGIN_EXPIRES_AT: 'next friday' }],
    ['expiry in the past', { REVIEW_LOGIN_EXPIRES_AT: inDays(-1) }],
    ['expiry more than 60 days out', { REVIEW_LOGIN_EXPIRES_AT: inDays(61) }],
  ])('%s: GET and POST both 404 with an empty, uncacheable body', async (_label, env) => {
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
    const { GET } = await route();
    const get = await GET(new NextRequest(`${ORIGIN}/auth/review-login`));
    const res = await post(form(CODE));
    for (const r of [get, res]) {
      expect(r.status).toBe(404);
      expect(await r.text()).toBe('');
      expect(r.headers.get('cache-control')).toContain('no-store');
    }
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('every other method answers the same empty 404, enabled or not', async () => {
    const mod = await route();
    for (const handler of [mod.OPTIONS, mod.PUT, mod.PATCH, mod.DELETE]) {
      const res = await handler();
      expect(res.status).toBe(404);
      expect(await res.text()).toBe('');
      expect(res.headers.get('allow')).toBeNull();
    }
  });
});

describe('GET (enabled)', () => {
  it('serves the no-store code form; the error param only picks a known message', async () => {
    const { GET } = await route();
    const res = await GET(new NextRequest(`${ORIGIN}/auth/review-login?error=<script>`));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const html = await res.text();
    expect(html).toContain('method="post"');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('role="alert"');
  });
});

describe('POST', () => {
  it('correct code → checks on the cookie-less client, other sessions revoked, THEN cookies set → 303 /app', async () => {
    const res = await post(form(CODE));
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/app');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: DEMO.email });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'th' });
    expect(probeSignOut).toHaveBeenCalledTimes(1);
    expect(probeSignOut).toHaveBeenCalledWith({ scope: 'others' });
    expect(setSession).toHaveBeenCalledWith(SESSION);
    // Order: the revocation happened before the session reached the cookies.
    expect(probeSignOut.mock.invocationCallOrder[0]).toBeLessThan(setSession.mock.invocationCallOrder[0]!);
  });

  it('extra form fields cannot pick another user or destination', async () => {
    const res = await post(`${form(CODE)}&email=victim%40venue.com&next=https%3A%2F%2Fevil.example`);
    expect(location(res).origin).toBe(ORIGIN);
    expect(location(res).pathname).toBe('/app');
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: DEMO.email });
  });

  it.each([['wrong', 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jm'], ['empty', '']])('%s code → back to the form, no mint', async (_l, code) => {
    const res = await post(form(code));
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/auth/review-login');
    expect(location(res).searchParams.get('error')).toBe('code');
    expect(location(res).search).not.toContain('k7p2');
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('a code in the query string is ignored (only the body counts)', async () => {
    const headers = new Headers({ origin: ORIGIN, 'x-forwarded-for': freshIp() });
    const { POST } = await route();
    const res = await POST(new NextRequest(`${ORIGIN}/auth/review-login?code=${CODE}`, { method: 'POST', headers }));
    expect(location(res).searchParams.get('error')).toBe('code');
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('cross-site Origin → 404 even with the right code (no login CSRF)', async () => {
    const res = await post(form(CODE), { origin: 'https://evil.example' });
    expect(res.status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('no lockout: 100 junk attempts spread over many IPs never block the reviewer on a fresh IP', async () => {
    for (let i = 0; i < 100; i += 1) await post(form('wrong-code-wrong-code'), { ip: `192.0.2.${i % 50}` });
    const res = await post(form(CODE), { ip: '203.0.113.200' });
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/app');
  });

  it('rate limit: the 6th attempt from one client in the window is refused before the compare', async () => {
    const ip = '203.0.113.50';
    for (let i = 0; i < 5; i += 1) await post(form('wrong-code-wrong-code'), { ip });
    const res = await post(form(CODE), { ip });
    expect(location(res).searchParams.get('error')).toBe('wait');
    expect(generateLink).not.toHaveBeenCalled();
  });

  it('logs one structured line per attempt with no code, e-mail or raw IP', async () => {
    const warn = vi.spyOn(console, 'warn');
    await post(form('wrong-code-wrong-code'), { ip: '203.0.113.99' });
    const line = String(warn.mock.calls.at(-1)?.[0]);
    expect(JSON.parse(line)).toMatchObject({ event: 'review_login', outcome: 'bad_code' });
    expect(line).not.toContain('wrong-code');
    expect(line).not.toContain('203.0.113.99');
    expect(line).not.toContain('@');
  });

  it('mint failure → generic error, no session', async () => {
    generateLink.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await post(form(CODE));
    expect(location(res).searchParams.get('error')).toBe('failed');
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(setSession).not.toHaveBeenCalled();
  });

  it('revoking the other sessions fails → refused, and no cookie was ever set', async () => {
    probeSignOut.mockImplementation(async ({ scope }: { scope: string }) =>
      scope === 'others' ? { error: { message: 'boom' } } : { error: null },
    );
    const res = await post(form(CODE));
    expect(location(res).searchParams.get('error')).toBe('failed');
    expect(setSession).not.toHaveBeenCalled();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  describe('fail closed: refused before any cookie is written', () => {
    it.each([
      ['a rebound e-mail on the demo id', () => verifyOtp.mockResolvedValue({ data: { user: { ...DEMO, email: 'max@venue.com' }, session: SESSION }, error: null })],
      ['the demo e-mail on another id', () => verifyOtp.mockResolvedValue({ data: { user: { ...DEMO, id: 'other-id' }, session: SESSION }, error: null })],
      ['a verified TOTP factor', () => listFactors.mockResolvedValue({ data: { totp: [{ id: 'f', status: 'verified' }] }, error: null })],
      ['platform admin', () => rpc.mockResolvedValue({ data: true, error: null })],
      ['platform flag unreadable', () => rpc.mockResolvedValue({ data: null, error: { message: 'x' } })],
      ['no membership', () => (ownMemberships = [])],
      ['a second venue', () => (ownMemberships = [{ venue_id: DEMO_VENUE_ID, roles: ['admin', 'doorhost'] }, { venue_id: 'w', roles: ['admin'] }])],
      ['a venue NAMED "PlusOne Demo" but with another id', () => (ownMemberships = [{ venue_id: 'aa000000-0000-7000-8000-000000000009', roles: ['admin', 'doorhost'] }])],
      ['another member in the demo venue', () => (venueMembers = [{ user_id: DEMO.id }, { user_id: 'someone-invited' }])],
      ['an open invite into the demo venue', () => (venueInvites = [{ id: 'i1' }])],
      ['an open invite addressed to the demo e-mail', () => (addressedInvites = [{ id: 'i2' }])],
      ['memberships unreadable', () => (failTable = 'venue_memberships')],
      ['invites unreadable', () => (failTable = 'invites')],
    ])('%s', async (_label, arrange) => {
      arrange();
      const res = await post(form(CODE));
      expect(location(res).pathname).toBe('/auth/review-login');
      expect(location(res).searchParams.get('error')).toBe('failed');
      expect(setSession).not.toHaveBeenCalled();
      expect(res.headers.get('set-cookie')).toBeNull();
    });

    it.each([
      ['demoted to doorhost', ['doorhost']],
      ['admin only', ['admin']],
      ['an extra role', ['admin', 'doorhost', 'finance']],
      ['roles missing', null],
    ])('roles changed (%s) → roles_changed, even though the counts look clean', async (_label, roles) => {
      // A demoted row cannot see the other members or the venue's invites, so
      // the isolation reads would come back "clean": the role check must win.
      ownMemberships = [{ venue_id: DEMO_VENUE_ID, roles }];
      venueMembers = [{ user_id: DEMO.id }];
      const warn = vi.spyOn(console, 'warn');
      const res = await post(form(CODE));
      expect(location(res).searchParams.get('error')).toBe('failed');
      expect(setSession).not.toHaveBeenCalled();
      expect(res.headers.get('set-cookie')).toBeNull();
      const logged = warn.mock.calls.map((c) => JSON.parse(String(c[0])));
      expect(logged).toContainEqual(expect.objectContaining({ outcome: 'refused', reason: 'roles_changed' }));
    });

    it('the seeded roles in another order still pass', async () => {
      ownMemberships = [{ venue_id: DEMO_VENUE_ID, roles: ['doorhost', 'admin'] }];
      const res = await post(form(CODE));
      expect(location(res).pathname).toBe('/app');
    });

    it('still refused cleanly when the sign-out itself rejects (no dependency on it)', async () => {
      rpc.mockResolvedValue({ data: true, error: null });
      probeSignOut.mockRejectedValue(new Error('lock'));
      const res = await post(form(CODE));
      expect(location(res).searchParams.get('error')).toBe('failed');
      expect(setSession).not.toHaveBeenCalled();
      expect(res.headers.get('set-cookie')).toBeNull();
    });
  });

  it('setSession failure → generic error', async () => {
    setSession.mockResolvedValue({ data: {}, error: { message: 'boom' } });
    const res = await post(form(CODE));
    expect(location(res).searchParams.get('error')).toBe('failed');
  });
});
