import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TERMS_VERSION } from '@/lib/legal';

// The /app layout's consent + MFA gates must send the user back to the deep
// link the middleware stamped into x-po-request-path — sanitized, since the
// header is client-controllable on matcher-skipped paths. Everything the layout
// touches besides that header is stubbed: this suite only asserts the `next=`
// each gate receives.

let requestHeaders = new Headers();
vi.mock('next/headers', () => ({
  headers: vi.fn(async () => requestHeaders),
}));

const redirectMock = vi.fn((url: string) => {
  throw new Error(`REDIRECT:${url}`);
});
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}));

const getSessionUserMock = vi.fn();
vi.mock('@/lib/auth/context', () => ({
  getSessionUser: () => getSessionUserMock(),
}));

const recommendMfaIfDueMock = vi.fn(async (_next: string) => {});
vi.mock('@/lib/auth/guards', () => ({
  recommendMfaIfDue: (next: string) => recommendMfaIfDueMock(next),
}));

let profileRow: Record<string, unknown> | null = null;
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
      }),
    }),
  })),
}));

vi.mock('@/lib/auth/onboarding', () => ({
  getOnboardingState: vi.fn(async () => ({ step: 'done' })),
}));
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: vi.fn(async () => []),
  getOrganizerVenues: vi.fn(async () => []),
  getReportingVenues: vi.fn(async () => []),
}));
vi.mock('@/lib/auth/active-venue', () => ({
  resolveActiveVenueId: vi.fn(async () => null),
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ PoLiveProvider: () => null }));
vi.mock('@/components/po/app-shell-data', () => ({ AppShellDataProvider: () => null }));
vi.mock('@/components/po/app-client', () => ({ PlusOneAppClient: () => null }));

const ACCEPTED = {
  full_name: 'Test',
  terms_accepted_at: '2026-07-01T00:00:00Z',
  terms_version: TERMS_VERSION,
};
const NOT_ACCEPTED = { full_name: 'Test', terms_accepted_at: null, terms_version: null };

async function renderLayout(): Promise<unknown> {
  const { default: AppLayout } = await import('./layout');
  return AppLayout({ children: null });
}

function withRequestPath(value: string | null): void {
  requestHeaders = new Headers();
  if (value !== null) requestHeaders.set('x-po-request-path', value);
}

describe('/app layout gates keep the requested deep link', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    recommendMfaIfDueMock.mockClear();
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue({ id: 'user-1', email: 'u@plusone.test' });
    profileRow = ACCEPTED;
    withRequestPath(null);
  });

  it('consent gate: next= carries the deep link, query included', async () => {
    profileRow = NOT_ACCEPTED;
    withRequestPath('/app/events/abc?door=1');

    await expect(renderLayout()).rejects.toThrow(
      `REDIRECT:/consent?next=${encodeURIComponent('/app/events/abc?door=1')}`
    );
    expect(recommendMfaIfDueMock).not.toHaveBeenCalled();
  });

  it('MFA recommendation: gets the deep link as its return path', async () => {
    withRequestPath('/app/contacts');

    await renderLayout();

    expect(redirectMock).not.toHaveBeenCalled();
    expect(recommendMfaIfDueMock).toHaveBeenCalledWith('/app/contacts');
  });

  it('login fallback (matcher-skipped paths): next= carries the deep link', async () => {
    getSessionUserMock.mockResolvedValue(null);
    withRequestPath('/app/profile');

    await expect(renderLayout()).rejects.toThrow(
      `REDIRECT:/login?next=${encodeURIComponent('/app/profile')}`
    );
  });

  it('missing header: falls back to bare /app (pre-fix behaviour)', async () => {
    profileRow = NOT_ACCEPTED;

    await expect(renderLayout()).rejects.toThrow(
      `REDIRECT:/consent?next=${encodeURIComponent('/app')}`
    );
  });

  it('forged header outside /app: falls back to bare /app', async () => {
    withRequestPath('/admin/team');

    await renderLayout();

    expect(recommendMfaIfDueMock).toHaveBeenCalledWith('/app');
  });

  it('forged off-site header: the open-redirect guard still holds', async () => {
    profileRow = NOT_ACCEPTED;
    withRequestPath('//evil.example/app');

    await expect(renderLayout()).rejects.toThrow(
      `REDIRECT:/consent?next=${encodeURIComponent('/app')}`
    );
  });
});
