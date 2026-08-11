import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// updateSession does a real network round-trip to Supabase Auth; stub it so
// this suite exercises only the middleware's own redirect logic.
const updateSessionMock = vi.fn();
vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: (...args: unknown[]) => updateSessionMock(...args),
}));

async function loadMiddleware() {
  vi.resetModules();
  return import('./middleware');
}

function mockAuthedUser() {
  updateSessionMock.mockImplementation(async () => ({
    response: NextResponse.next(),
    user: { id: 'user-1' },
    gate: { isAal2: true, hasFactor: false, requiresMfa: false },
  }));
}

function mockAnonymous() {
  updateSessionMock.mockImplementation(async () => ({
    response: NextResponse.next(),
    user: null,
    gate: { isAal2: true, hasFactor: false, requiresMfa: false },
  }));
}

describe('middleware — authed /login and / redirects', () => {
  beforeEach(() => updateSessionMock.mockReset());

  it('honours ?next= for an already-authed /login visit (86ey9ea00 #57)', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/login?next=%2Fapp%2Fprofile');

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/app/profile');
    expect(location.search).toBe('');
  });

  it('preserves a next target that itself carries a query string', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/login?next=%2Fapp%3Ftab%3Dteam');

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/app');
    expect(location.search).toBe('?tab=team');
  });

  it('falls back to /app when /login has no next param', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/login');

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/app');
    expect(location.search).toBe('');
  });

  it('falls back to /app for an off-site next (open-redirect guard still applies)', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest(
      'http://localhost:3000/login?next=' + encodeURIComponent('https://evil.example/phish')
    );

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/app');
  });

  it('ignores ?next= on the marketing root — always lands on /app', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/?next=%2Fapp%2Fprofile');

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/app');
    expect(location.search).toBe('');
  });

  it('does not redirect an authed visit to a route other than /login or /', async () => {
    mockAuthedUser();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app');

    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });
});

describe('middleware — unauthenticated access (unchanged behaviour)', () => {
  beforeEach(() => updateSessionMock.mockReset());

  it('still redirects a protected route to /login, remembering the target', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app?new=event');

    const res = await middleware(req);

    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/app?new=event');
  });

  it('lets an anonymous visitor stay on the public /login route', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/login');

    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });
});
