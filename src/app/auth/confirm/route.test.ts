import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

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
