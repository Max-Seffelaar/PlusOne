import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// P-01 (z8uq9m0tnq): the route no longer trusts the type the mail declared, so
// the verify path itself needs coverage — the guard tests below stop before any
// Supabase call. The mocks stand in for the SSR client and the destination
// resolver; everything else is the real route.
const verifyOtp = vi.fn();
const rpc = vi.fn().mockResolvedValue({ error: null });

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { verifyOtp }, rpc }),
}));
vi.mock('@/features/auth/entry-redirect', () => ({
  resolveEntryDestination: async (_userId: string, next: string) => next,
}));

const mismatch = { status: 403, message: 'Token has expired or is invalid' };
const user = { id: '00000000-0000-7000-8000-000000000001' };

async function get(url: string) {
  const { GET } = await import('./route');
  return GET(new NextRequest(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ error: null });
});

// emailOtpTypeSchema itself is tested in features/auth/schemas.test.ts (where
// it now lives — a Route Handler file may only export the handful of names
// Next.js recognizes, so the schema can't live in route.ts alongside GET).

// These two guards run before any Supabase call, so no client mocking is
// needed to exercise them.
describe('GET /auth/confirm — guard branches', () => {
  it('missing token_hash redirects to bare /login', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/auth/confirm?type=signup');

    const res = await GET(req);

    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    expect(new URL(res.headers.get('location')!).search).toBe('');
  });

  it('token_hash present but an unrecognized type redirects to /login?error=link, not a silent bare /login', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/auth/confirm?token_hash=abc123&type=bogus');

    const res = await GET(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('link');
  });

  it('token_hash present but type entirely missing also redirects to /login?error=link', async () => {
    const { GET } = await import('./route');
    const req = new NextRequest('http://localhost:3000/auth/confirm?token_hash=abc123');

    const res = await GET(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('link');
  });
});

describe('GET /auth/confirm — first-login verify fallback', () => {
  it('verifies the declared type first and stops there when it works', async () => {
    verifyOtp.mockResolvedValue({ data: { user }, error: null });

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=invite&next=/app');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(verifyOtp).toHaveBeenCalledWith({ type: 'invite', token_hash: 'abc' });
    expect(rpc).toHaveBeenCalledWith('accept_pending_invites');
    expect(new URL(res.headers.get('location')!).pathname).toBe('/app');
  });

  it('falls through to the OTHER token slot when the declared type misses', async () => {
    verifyOtp.mockImplementation(async ({ type }: { type: string }) =>
      type === 'magiclink' ? { data: { user }, error: null } : { data: { user: null }, error: mismatch }
    );

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=invite&next=/app');

    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['invite', 'magiclink']);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/app');
  });

  it('never tries a third type — one click costs at most two verifies', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: mismatch });

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=signup&next=/app');

    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['signup', 'magiclink']);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('error')).toBe('link');
  });

  it('does not fall back out of a flow of its own (email_change), nor into recovery', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: mismatch });

    await get('http://localhost:3000/auth/confirm?token_hash=abc&type=email_change');
    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['email_change']);

    vi.clearAllMocks();
    verifyOtp.mockResolvedValue({ data: { user: null }, error: mismatch });
    await get('http://localhost:3000/auth/confirm?token_hash=abc&type=magiclink');
    expect(verifyOtp.mock.calls.map((c) => c[0].type)).toEqual(['magiclink', 'invite']);
    expect(verifyOtp.mock.calls.map((c) => c[0].type)).not.toContain('recovery');
  });

  it('treats a verify that returns no user as TERMINAL — the token is spent, do not burn the sibling', async () => {
    verifyOtp.mockResolvedValue({ data: { user: null }, error: null });

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=invite');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(rpc).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('link');
  });

  it('stops immediately on a rate limit instead of spending the sibling slot', async () => {
    verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { status: 429, message: 'Email rate limit exceeded' },
    });

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=invite');

    expect(verifyOtp).toHaveBeenCalledTimes(1);
    expect(new URL(res.headers.get('location')!).searchParams.get('error')).toBe('link');
  });

  it('sends the e-mail-change confirmation to the profile screen, not the app home', async () => {
    verifyOtp.mockResolvedValue({ data: { user }, error: null });

    const res = await get('http://localhost:3000/auth/confirm?token_hash=abc&type=email_change');

    expect(new URL(res.headers.get('location')!).pathname).toBe('/app/profile');
  });
});
