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

describe('middleware — x-po-request-path stamp for the /app layout gates', () => {
  beforeEach(() => updateSessionMock.mockReset());

  // Same forwarding as the real updateSession: NextResponse.next({ request })
  // snapshots request.headers into x-middleware-request-* override headers,
  // which is what the /app layout's headers() will see.
  function mockForwardingSession() {
    updateSessionMock.mockImplementation(async (request: NextRequest) => ({
      response: NextResponse.next({ request }),
      user: { id: 'user-1' },
      gate: { isAal2: true, hasFactor: false, requiresMfa: false },
    }));
  }

  function forwarded(res: NextResponse): string | null {
    return res.headers.get('x-middleware-request-x-po-request-path');
  }

  it('forwards the deep-link path + query to the rendered route', async () => {
    mockForwardingSession();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app/events/abc?door=1');

    const res = await middleware(req);

    expect(forwarded(res)).toBe('/app/events/abc?door=1');
    expect(res.headers.get('x-middleware-override-headers')).toContain('x-po-request-path');
  });

  it("strips Next's _rsc param from the forwarded value", async () => {
    mockForwardingSession();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app/contacts?_rsc=abc123');

    const res = await middleware(req);

    expect(forwarded(res)).toBe('/app/contacts');
  });

  it('overwrites a client-supplied header instead of trusting it', async () => {
    mockForwardingSession();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app/contacts', {
      headers: { 'x-po-request-path': '/admin/team' },
    });

    const res = await middleware(req);

    expect(forwarded(res)).toBe('/app/contacts');
  });

  it('is stamped before updateSession runs, so its NextResponse.next carries it', async () => {
    mockForwardingSession();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/app/profile');

    await middleware(req);

    const seen = updateSessionMock.mock.calls[0][0] as NextRequest;
    expect(seen.headers.get('x-po-request-path')).toBe('/app/profile');
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
