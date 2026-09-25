import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

// /auth/review-login/end: signs out the demo account once its review window is
// closed, and does nothing at all for anyone else.
const getUser = vi.fn();
const signOut = vi.fn();
const clientKey = vi.fn();
const real = vi.hoisted(() => ({ key: null as ((h: Headers) => string) | null }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser, signOut } }),
}));
vi.mock('@/features/auth/review-login', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/auth/review-login')>();
  real.key = actual.reviewClientKey;
  return { ...actual, reviewClientKey: (h: Headers) => clientKey(h) };
});

const ORIGIN = 'http://localhost:3000';
const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };
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
  clientKey.mockImplementation((h: Headers) => real.key!(h));
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

  it('demo id with a rebound e-mail is still caught (keyed on the id too)', async () => {
    getUser.mockResolvedValue({ data: { user: { ...DEMO, email: 'rebound@attacker.example' } } });
    const res = await hit();
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
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

  it('the revoke does not depend on logging: a throwing client key still signs out and logs "no-client"', async () => {
    // reviewClientKey throws in production when LANDING_IP_SALT is unset.
    clientKey.mockImplementation(() => {
      throw new Error('LANDING_IP_SALT missing');
    });
    getUser.mockResolvedValue({ data: { user: DEMO } });
    const res = await hit();
    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
    const lines = [...vi.mocked(console.info).mock.calls, ...vi.mocked(console.warn).mock.calls].map((c) => JSON.parse(String(c[0])));
    expect(lines).toContainEqual(expect.objectContaining({ outcome: 'session_ended', client: 'no-client' }));
  });

  it('sign-out runs before the client key is computed', async () => {
    const order: string[] = [];
    signOut.mockImplementation(async () => (order.push('signOut'), { error: null }));
    clientKey.mockImplementation(() => (order.push('key'), 'k'.repeat(64)));
    getUser.mockResolvedValue({ data: { user: DEMO } });
    await hit();
    expect(order).toEqual(['signOut', 'key']);
  });

  it('sign-out failure → 503, not a redirect (a redirect would loop /login → /app → here)', async () => {
    getUser.mockResolvedValue({ data: { user: DEMO } });
    signOut.mockResolvedValue({ error: { message: 'boom' } });
    const res = await hit();
    expect(res.status).toBe(503);
    expect(res.headers.get('location')).toBeNull();
  });
});
