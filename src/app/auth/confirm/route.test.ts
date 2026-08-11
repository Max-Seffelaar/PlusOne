import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { emailOtpTypeSchema } from './route';

// `EmailOtpType` (auth-js) is an open union (`... | (string & {})`), so
// `satisfies z.ZodType<EmailOtpType>` on the schema in route.ts enforces
// nothing at compile time — a trimmed or misspelled list still typechecks.
// This pins the exact six values GoTrue accepts for link-based verification,
// so a drift (a 7th type added upstream, a typo) is caught here instead of
// silently narrowing what the route accepts.
describe('emailOtpTypeSchema', () => {
  const VALID = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

  it('accepts exactly the six link-verification types GoTrue supports', () => {
    for (const type of VALID) {
      expect(emailOtpTypeSchema.safeParse(type).success).toBe(true);
    }
  });

  it('rejects an unrecognized type, null, and a phone-OTP type (out of scope for this route)', () => {
    expect(emailOtpTypeSchema.safeParse('bogus').success).toBe(false);
    expect(emailOtpTypeSchema.safeParse(null).success).toBe(false);
    expect(emailOtpTypeSchema.safeParse('sms').success).toBe(false); // MobileOtpType, not EmailOtpType
  });
});

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
