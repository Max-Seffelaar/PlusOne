import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { hasAcceptedCurrentTerms } from '@/lib/auth/consent';
import { getOnboardingState } from '@/lib/auth/onboarding';

// Both Supabase clients need a request context (cookies()) or real keys, so
// each test hands back a minimal fake. The consent/onboarding lookups are
// mocked one level below `resolveEntryDestination`, so the real entry-redirect
// logic runs: that is the hop this suite exists to pin.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/auth/consent', () => ({ hasAcceptedCurrentTerms: vi.fn() }));
vi.mock('@/lib/auth/onboarding', () => ({ getOnboardingState: vi.fn() }));

const USER_ID = '22222222-2222-4222-8222-222222222222';
const BASE = 'http://localhost:7000/auth/dev-login?email=manager%40plusone.test';

let warn: Mock;
const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:55321';
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined) as unknown as Mock;
  (createServiceClient as Mock).mockReturnValue({
    auth: {
      admin: {
        generateLink: vi.fn(async () => ({ data: { properties: { hashed_token: 'hash' } }, error: null })),
      },
    },
  });
  (createClient as Mock).mockResolvedValue({
    auth: {
      verifyOtp: vi.fn(async () => ({ data: { user: { id: USER_ID } }, error: null })),
      mfa: { listFactors: vi.fn(async () => ({ data: { totp: [] } })) },
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  });
  (hasAcceptedCurrentTerms as Mock).mockResolvedValue(true);
  (getOnboardingState as Mock).mockResolvedValue({ step: 'done' });
});

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

async function devLogin(next: string | null): Promise<URL> {
  const { GET } = await import('./route');
  const url = next === null ? BASE : `${BASE}&next=${encodeURIComponent(next)}`;
  const res = await GET(new NextRequest(url));
  expect(res.status).toBe(307);
  return new URL(res.headers.get('location')!);
}

describe('GET /auth/dev-login: next handling', () => {
  it('lands on the requested deep link', async () => {
    const dest = await devLogin('/app/contacts');

    expect(dest.origin).toBe('http://localhost:7000');
    expect(dest.pathname + dest.search).toBe('/app/contacts');
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps the deep link through the consent gate instead of letting /app flatten it', async () => {
    (hasAcceptedCurrentTerms as Mock).mockResolvedValue(false);

    const dest = await devLogin('/app/contacts');

    expect(dest.pathname).toBe('/consent');
    expect(dest.searchParams.get('next')).toBe('/app/contacts');
    expect(hasAcceptedCurrentTerms).toHaveBeenCalledWith(USER_ID);
  });

  it('defaults to /app without a warning when no next is given', async () => {
    const dest = await devLogin(null);

    expect(dest.pathname + dest.search).toBe('/app');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to /app on a Git-Bash-mangled path and says why', async () => {
    const dest = await devLogin('C:/Program Files/Git/app/contacts');

    expect(dest.pathname + dest.search).toBe('/app');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('C:/Program Files/Git/app/contacts');
    expect(warn.mock.calls[0][0]).toContain('MSYS_NO_PATHCONV=1');
  });

  it('stays open-redirect safe: an off-site next lands on /app on this origin', async () => {
    for (const evil of ['//evil.com/app', 'https://evil.com/app', '/\\evil.com']) {
      warn.mockClear();
      const dest = await devLogin(evil);

      expect(dest.origin).toBe('http://localhost:7000');
      expect(dest.pathname + dest.search).toBe('/app');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).not.toContain('MSYS_NO_PATHCONV');
    }
  });

  it('404s against a hosted Supabase URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://tolxwgqhppdcvnogdpel.supabase.co';
    const { GET } = await import('./route');

    const res = await GET(new NextRequest(`${BASE}&next=%2Fapp%2Fcontacts`));

    expect(res.status).toBe(404);
    expect(createServiceClient).not.toHaveBeenCalled();
  });
});
