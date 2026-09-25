import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
let myMemberships: { venueId: string; venueName: string; roles: string[] }[] = [];
const getPlatformAdminVenueMock = vi.fn(async (_venueId: string) => null as { venueId: string; venueName: string; roles: string[] } | null);
vi.mock('@/lib/auth/memberships', () => ({
  getMyMemberships: vi.fn(async () => myMemberships),
  getOrganizerVenues: vi.fn(async () => []),
  getReportingVenues: vi.fn(async () => []),
  // Not a platform admin in this suite by default — the P-05 support-access
  // fallback (layout.tsx) always resolves to null, same as everyone else.
  // Individual tests below override this to exercise the fallback itself.
  getPlatformAdminVenue: (venueId: string) => getPlatformAdminVenueMock(venueId),
}));
let activeVenueCookieValue: string | null = null;
vi.mock('@/lib/auth/active-venue', () => ({
  // Mirrors the REAL resolveActiveVenueId's contract: only ever returns an
  // id already in `candidates`, defaulting to the first one — never the raw
  // cookie value verbatim. Tests below rely on that to prove layout.tsx
  // checks the cookie against `accessVenues` BEFORE falling back to this.
  resolveActiveVenueId: vi.fn(async (candidates: { venueId: string }[]) => candidates[0]?.venueId ?? null),
  getActiveVenueCookieValue: vi.fn(async () => activeVenueCookieValue),
}));
// `AppLayout` is called directly below, with no renderer — its return value
// is a plain React element DESCRIPTOR (`{type, props, ...}`), never actually
// invoked as a function. So `PoLiveProvider`/`AppShellDataProvider` need no
// call-capturing mock: their PROPS are inspected straight off that
// descriptor tree (see `identityOf`/`shellValueOf` below), the same way the
// existing tests read `redirectMock`'s thrown URL.
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

// Pulls the identity/shell props straight off the JSX descriptor tree
// `renderLayout()` returns — see the note above the PoLiveProvider mock for
// why this reads props rather than a call-capturing mock.
interface ReactEl {
  props: Record<string, unknown>;
}
interface Identity {
  venueId: string | null;
  venueName: string | null;
  roles: string[];
}
function identityOf(el: unknown): Identity {
  return (el as ReactEl).props.identity as Identity;
}
function shellValueOf(el: unknown): Record<string, unknown> {
  const shellEl = (el as ReactEl).props.children as ReactEl;
  return shellEl.props.value as Record<string, unknown>;
}

describe('/app layout gates keep the requested deep link', () => {
  beforeEach(() => {
    redirectMock.mockClear();
    recommendMfaIfDueMock.mockClear();
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue({ id: 'user-1', email: 'u@plusone.test' });
    profileRow = ACCEPTED;
    withRequestPath(null);
    myMemberships = [];
    activeVenueCookieValue = null;
    getPlatformAdminVenueMock.mockReset();
    getPlatformAdminVenueMock.mockResolvedValue(null);
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

// P-05 (z8uq9m0tnx) — the platform-admin venue-switch cookie fallback. Both
// cases matter equally: the negative one is the invariant that actually
// protects everyone else (a foreign cookie value must NEVER silently become
// the active venue for someone who isn't a platform admin), and it is the
// one a naive refactor is most likely to regress since the happy path
// (a real member's own venue) looks identical either way.
describe('/app layout — platform-admin cookie fallback (z8uq9m0tnx)', () => {
  const OWN_VENUE = 'own-venue-id';
  const FOREIGN_VENUE = 'foreign-venue-id';

  beforeEach(() => {
    redirectMock.mockClear();
    recommendMfaIfDueMock.mockClear();
    getSessionUserMock.mockReset();
    getSessionUserMock.mockResolvedValue({ id: 'user-1', email: 'u@plusone.test' });
    profileRow = ACCEPTED;
    withRequestPath(null);
    myMemberships = [{ venueId: OWN_VENUE, venueName: 'Own Venue', roles: ['admin'] }];
    getPlatformAdminVenueMock.mockReset();
  });

  it("negative — not a platform admin: a foreign cookie never hijacks the real member's own venue", async () => {
    activeVenueCookieValue = FOREIGN_VENUE;
    getPlatformAdminVenueMock.mockResolvedValue(null); // not a platform admin

    const el = await renderLayout();

    const identity = identityOf(el);
    expect(identity.venueId).toBe(OWN_VENUE);
    expect(identity.venueId).not.toBe(FOREIGN_VENUE);
    expect(shellValueOf(el).activeVenueId).toBe(OWN_VENUE);
  });

  it('positive — a platform admin: the foreign cookie DOES land them there, roles: [], labelled as support', async () => {
    activeVenueCookieValue = FOREIGN_VENUE;
    getPlatformAdminVenueMock.mockResolvedValue({ venueId: FOREIGN_VENUE, venueName: 'Foreign Venue', roles: [] });

    const el = await renderLayout();

    const identity = identityOf(el);
    expect(identity.venueId).toBe(FOREIGN_VENUE);
    expect(identity.venueName).toBe('Foreign Venue');
    expect(identity.roles).toEqual([]);
    const shellValue = shellValueOf(el);
    expect(shellValue.activeVenueId).toBe(FOREIGN_VENUE);
    expect(shellValue.liveUserSub).toBe('Platform admin (support)');
  });

  it("a matching cookie (the caller's own real venue) never touches the platform-admin fallback at all", async () => {
    activeVenueCookieValue = OWN_VENUE;

    const el = await renderLayout();

    expect(getPlatformAdminVenueMock).not.toHaveBeenCalled();
    expect(identityOf(el).venueId).toBe(OWN_VENUE);
  });
});

// Store-review demo account (86ey6bfug): its sessions die with the review window.
describe('/app layout ends a demo-account session once the review window closes', () => {
  const DEMO = { id: 'de300000-0000-7000-8000-00000000a001', email: 'app-review@demo.plus-one.io' };
  const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

  beforeEach(() => {
    redirectMock.mockClear();
    getSessionUserMock.mockReset();
    profileRow = ACCEPTED;
    withRequestPath(null);
    myMemberships = [{ venueId: 'de300000-0000-7000-8000-000000000001', venueName: 'PlusOne Demo', roles: ['admin'] }];
    activeVenueCookieValue = null;
    vi.stubEnv('REVIEW_LOGIN_CODE', 'k7p2-x9qm-4hzt-8wva-3bcd-efgh-jk');
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(7));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('closed window (expiry past) → sent to the sign-out route before anything else runs', async () => {
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(-1));
    getSessionUserMock.mockResolvedValue(DEMO);
    await expect(renderLayout()).rejects.toThrow('REDIRECT:/auth/review-login/end');
  });

  it('the demo id with a rebound e-mail is caught too (keyed on the id)', async () => {
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', inDays(-1));
    getSessionUserMock.mockResolvedValue({ ...DEMO, email: 'rebound@attacker.example' });
    await expect(renderLayout()).rejects.toThrow('REDIRECT:/auth/review-login/end');
  });

  it('code removed → same', async () => {
    vi.stubEnv('REVIEW_LOGIN_CODE', '');
    getSessionUserMock.mockResolvedValue(DEMO);
    await expect(renderLayout()).rejects.toThrow('REDIRECT:/auth/review-login/end');
  });

  it('open window → the demo account renders the app normally', async () => {
    getSessionUserMock.mockResolvedValue(DEMO);
    await renderLayout();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('closed window never affects any other user', async () => {
    vi.stubEnv('REVIEW_LOGIN_EXPIRES_AT', '');
    getSessionUserMock.mockResolvedValue({ id: 'user-1', email: 'u@plusone.test' });
    await renderLayout();
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
