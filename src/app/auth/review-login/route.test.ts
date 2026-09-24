import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// The route with Supabase mocked out: the service client (generateLink) and the
// user-scoped SSR client (verifyOtp + the fail-closed account checks).
const generateLink = vi.fn();
const verifyOtp = vi.fn();
const listFactors = vi.fn();
const signOut = vi.fn();
const rpc = vi.fn();
const membershipsEq = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: membershipsEq }) }));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ auth: { admin: { generateLink } } }),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp, mfa: { listFactors }, signOut }, rpc, from }),
}));
vi.mock('@/features/auth/entry-redirect', () => ({
  resolveEntryDestination: async (_userId: string, next: string) => next,
}));

const CODE = 'k7p2-x9qm-4hzt-8wva';
const ORIGIN = 'http://localhost:3000';
const DEMO = { id: '00000000-0000-7000-8000-00000000de30', email: 'app-review@demo.plus-one.io' };

let ipCounter = 0;
function freshIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter}`;
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
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  generateLink.mockResolvedValue({ data: { properties: { hashed_token: 'th' } }, error: null });
  verifyOtp.mockResolvedValue({ data: { user: DEMO }, error: null });
  listFactors.mockResolvedValue({ data: { totp: [] }, error: null });
  signOut.mockResolvedValue({ error: null });
  rpc.mockResolvedValue({ data: false, error: null });
  membershipsEq.mockResolvedValue({ data: [{ venue_id: 'v', venues: { name: 'PLUSONE Demo' } }], error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('disabled (REVIEW_LOGIN_CODE unset / blank / too short) → 404, no hint', () => {
  it.each([['unset', undefined], ['empty', ''], ['whitespace', '   '], ['too short', 'short-code']])(
    '%s: GET and POST both 404 with an empty, uncacheable body',
    async (_label, value) => {
      if (value === undefined) vi.stubEnv('REVIEW_LOGIN_CODE', undefined as unknown as string);
      else vi.stubEnv('REVIEW_LOGIN_CODE', value);
      const { GET } = await route();
      const get = await GET(new NextRequest(`${ORIGIN}/auth/review-login`));
      const res = await post(form(CODE));
      for (const r of [get, res]) {
        expect(r.status).toBe(404);
        expect(await r.text()).toBe('');
        expect(r.headers.get('cache-control')).toContain('no-store');
      }
      expect(generateLink).not.toHaveBeenCalled();
    },
  );
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
  it('correct code → demo session → 303 to /app, one service-role call for the constant address', async () => {
    const res = await post(form(CODE));
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/app');
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(generateLink).toHaveBeenCalledTimes(1);
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: DEMO.email });
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'magiclink', token_hash: 'th' });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('extra form fields cannot pick another user or destination', async () => {
    const res = await post(`${form(CODE)}&email=victim%40venue.com&next=https%3A%2F%2Fevil.example`);
    expect(location(res).origin).toBe(ORIGIN);
    expect(location(res).pathname).toBe('/app');
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: DEMO.email });
  });

  it.each([['wrong', 'k7p2-x9qm-4hzt-8wvb'], ['empty', '']])('%s code → back to the form, no mint', async (_l, code) => {
    const res = await post(form(code));
    expect(res.status).toBe(303);
    expect(location(res).pathname).toBe('/auth/review-login');
    expect(location(res).searchParams.get('error')).toBe('code');
    expect(location(res).search).not.toContain(code || 'nothing');
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
  });

  describe('fail closed: the session is signed out again unless it is the demo account as seeded', () => {
    it.each([
      ['another e-mail', () => verifyOtp.mockResolvedValue({ data: { user: { ...DEMO, email: 'max@venue.com' } }, error: null })],
      ['a verified TOTP factor', () => listFactors.mockResolvedValue({ data: { totp: [{ id: 'f', status: 'verified' }] }, error: null })],
      ['platform admin', () => rpc.mockResolvedValue({ data: true, error: null })],
      ['platform flag unreadable', () => rpc.mockResolvedValue({ data: null, error: { message: 'x' } })],
      ['no membership', () => membershipsEq.mockResolvedValue({ data: [], error: null })],
      [
        'a second venue',
        () =>
          membershipsEq.mockResolvedValue({
            data: [
              { venue_id: 'v', venues: { name: 'PLUSONE Demo' } },
              { venue_id: 'w', venues: { name: 'Real Club' } },
            ],
            error: null,
          }),
      ],
      ['the wrong venue', () => membershipsEq.mockResolvedValue({ data: [{ venue_id: 'w', venues: { name: 'Real Club' } }], error: null })],
    ])('%s', async (_label, arrange) => {
      arrange();
      const res = await post(form(CODE));
      expect(location(res).pathname).toBe('/auth/review-login');
      expect(location(res).searchParams.get('error')).toBe('failed');
      expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    });
  });
});
