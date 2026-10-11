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

  // Only /app reads the header, and a bearer token in the URL of /r, /i or a
  // webhook route has no business being copied into it (code review 23/9).
  it('is not stamped on routes outside /app, and a client value is dropped there', async () => {
    mockForwardingSession();
    const { middleware } = await loadMiddleware();
    for (const path of ['/r/tok-123', '/i/tok-456', '/s/tok-789', '/u/tok-012', '/n/tok-345', '/api/webhooks/stripe', '/appx', '/door/e1']) {
      const req = new NextRequest(`http://localhost:3000${path}`, {
        headers: { 'x-po-request-path': '/app/profile' },
      });

      const res = await middleware(req);

      expect(forwarded(res), path).toBeNull();
    }
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

  it('lets an anonymous guest open the guest-mail bearer pages (/s status + .ics, /u opt-out incl. one-click POST)', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    for (const [path, method] of [
      ['/s/tok-123', 'GET'],
      ['/s/tok-123/calendar.ics', 'GET'],
      ['/u/tok-456', 'GET'],
      ['/u/tok-456', 'POST'],
      ['/n/tok-456', 'GET'],
      ['/n/tok-456', 'POST'],
    ] as const) {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`, { method }));
      expect(res.headers.get('location'), `${method} ${path}`).toBeNull();
    }
    // The prefix is the segment, not a substring: /settings stays protected.
    const res = await middleware(new NextRequest('http://localhost:3000/settings'));
    expect(res.headers.get('location')).not.toBeNull();
  });

  it('lets an anonymous visitor stay on the public /login route', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    const req = new NextRequest('http://localhost:3000/login');

    const res = await middleware(req);

    expect(res.headers.get('location')).toBeNull();
  });
});

describe('middleware — review demo session ended by updateSession (86ey6bfug)', () => {
  beforeEach(() => updateSessionMock.mockReset());

  it('returns updateSession’s sign-out redirect as is, on every covered route', async () => {
    const { middleware } = await loadMiddleware();
    for (const path of ['/app', '/door/e1', '/app/profile', '/login']) {
      const ended = NextResponse.redirect(new URL('/login', 'http://localhost:3000'), 303);
      ended.cookies.set('sb-local-auth-token', '', { maxAge: 0 });
      updateSessionMock.mockImplementation(async () => ({
        response: ended,
        user: null,
        gate: { isAal2: true, hasFactor: false, requiresMfa: false },
        demoSessionEnded: true,
      }));

      const res = await middleware(new NextRequest(`http://localhost:3000${path}`));

      expect(res, path).toBe(ended);
      expect(new URL(res.headers.get('location')!).search, path).toBe('');
    }
  });

  it('public exceptions stay public: an anonymous Stripe webhook POST passes straight through', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    for (const path of ['/api/webhooks/stripe', '/e/some-event', '/auth/review-login']) {
      const res = await middleware(new NextRequest(`http://localhost:3000${path}`, { method: 'POST' }));
      expect(res.headers.get('location'), path).toBeNull();
    }
  });
});

// Share-import S2 (z8uq9m43m8): when no service worker answers the PWA share
// target on the device, `/app/share?text=…` (a guest list) reaches middleware.
// It may not be copied into a second URL: not into the login `next=`, not into
// the header the /app gates turn into their `next=`.
describe('middleware — a shared guest list never rides along in next=', () => {
  beforeEach(() => updateSessionMock.mockReset());

  const SHARE = 'http://localhost:3000/app/share?title=Friday&text=Milan+Hendriks+%2B2%0AFleur&url=https%3A%2F%2Fx.test';

  it('signed out: /login?next=/app/share, no text/title/url and no name anywhere in the redirect', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    const res = await middleware(new NextRequest(SHARE));
    const raw = res.headers.get('location')!;
    const location = new URL(raw);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/app/share');
    expect(decodeURIComponent(raw)).not.toMatch(/Milan|Friday|x\.test/);
  });

  it('signed in: the gate header carries /app/share without the payload', async () => {
    updateSessionMock.mockImplementation(async (request: NextRequest) => ({
      response: NextResponse.next({ request }),
      user: { id: 'user-1' },
      gate: { isAal2: true, hasFactor: false, requiresMfa: false },
    }));
    const { middleware } = await loadMiddleware();
    const res = await middleware(new NextRequest(SHARE));
    expect(res.headers.get('x-middleware-request-x-po-request-path')).toBe('/app/share');
  });

  it('any other deep link keeps its query in next= (unchanged behaviour)', async () => {
    mockAnonymous();
    const { middleware } = await loadMiddleware();
    const res = await middleware(new NextRequest('http://localhost:3000/app/contacts?text=a%20b'));
    expect(new URL(res.headers.get('location')!).searchParams.get('next')).toBe('/app/contacts?text=a%20b');
  });
});
