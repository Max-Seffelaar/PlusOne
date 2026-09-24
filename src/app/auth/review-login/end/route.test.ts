import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// /auth/review-login/end: signs out the demo account once its review window is
// closed, and does nothing at all for anyone else.
const getUser = vi.fn();
const signOut = vi.fn();
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}));

const ORIGIN = 'http://localhost:3000';
const DEMO = { id: 'd', email: 'app-review@demo.plus-one.io' };
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

async function hit() {
  const { GET } = await import('./route');
  return GET(new NextRequest(`${ORIGIN}/auth/review-login/end`, { headers: { 'x-forwarded-for': '203.0.113.1' } }));
}

function openWindow(): void {
  vi.stubEnv('REVIEW_LOGIN_CODE', 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk');
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('REVIEW_LOGIN_CODE', '');
  vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', '');
  vi.spyOn(console, 'info').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  signOut.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /auth/review-login/end', () => {
  it('demo account + closed window → every demo session revoked, lands on /login', async () => {
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await hit();
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('demo account + OPEN window → untouched, back to /app (no cross-site logout of a reviewer)', async () => {
    openWindow();
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await hit();
    expect(signOut).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/app');
  });

  it('any other user → untouched, back to /app', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'u', email: 'max@venue.com' } } });
    const res = await hit();
    expect(signOut).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/app');
  });

  it('no session → /login, nothing to sign out', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const res = await hit();
    expect(signOut).not.toHaveBeenCalled();
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
  });

  it('sign-out failure → 503, not a redirect (a redirect would loop /login → /app → here)', async () => {
    getUser.mockResolvedValue({ data: { user: DEMO } });
    signOut.mockResolvedValue({ error: { message: 'boom' } });
    const res = await hit();
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
  });
});
