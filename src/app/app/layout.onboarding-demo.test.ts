/**
 * /app layout onboarding gate vs the store-review demo account (86ey6bfug).
 * The demo account is admin of the demo venue, so it can PATCH
 * settings.onboarding.completed back to false; the layout must still never send
 * it to /onboarding (whose steps only create venues and send invites, both
 * refused for it). A normal user in an unfinished onboarding still goes there.
 * The layout is run up to the first read after the gate, which throws a marker.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  onboarding: vi.fn(async () => ({ step: 'team', venueId: 'v1' })),
}));

class Redirect extends Error {}
class PastGate extends Error {}

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
vi.mock('@/features/po/PoLiveProvider', () => ({ PoLiveProvider: () => null }));
vi.mock('@/components/po/app-shell-data', () => ({ AppShellDataProvider: () => null }));
vi.mock('@/components/po/app-client', () => ({ PlusOneAppClient: () => null }));
vi.mock('@/lib/auth/onboarding', () => ({ getOnboardingState: H.onboarding }));
vi.mock('@/lib/auth/guards', () => ({ recommendMfaIfDue: vi.fn() }));
vi.mock('@/lib/auth/consent', () => ({ acceptedCurrentTerms: vi.fn() }));
vi.mock('@/lib/auth/memberships', () => ({
  // The first read after the onboarding gate: reaching it means "past the gate".
  getReportingVenues: () => {
    throw new PastGate();
  },
  getMyMemberships: vi.fn(),
  getOrganizerVenues: vi.fn(),
  getPlatformAdminVenue: vi.fn(),
}));
vi.mock('@/lib/auth/context', () => ({ getSessionUser: async () => H.user }));
vi.mock('@/lib/auth/active-venue', () => ({ resolveActiveVenueId: vi.fn(), getActiveVenueCookieValue: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/ua', () => ({ isMobileUA: () => false }));
vi.mock('@/features/auth/review-window', async (orig) => ({
  ...(await orig<typeof import('@/features/auth/review-window')>()),
  // Review window open: the session may live. isDemoReviewUser stays real.
  demoSessionMustEnd: () => false,
}));

import AppLayout from './layout';
import { DEMO_USER_ID } from '@/features/auth/demo-account';

async function run(): Promise<unknown> {
  try {
    await AppLayout({ children: null });
    return 'rendered';
  } catch (e) {
    return e;
  }
}

beforeEach(() => {
  H.onboarding.mockClear();
});

describe('/app layout onboarding gate', () => {
  it('never sends the demo account to /onboarding, even with an unfinished demo venue', async () => {
    H.user = { id: DEMO_USER_ID, email: 'app-review@demo.plus-one.io' };
    const out = await run();
    expect(out).toBeInstanceOf(PastGate);
    expect(H.onboarding).not.toHaveBeenCalled();
  });

  it('keys on the e-mail too (either half is enough)', async () => {
    H.user = { id: '018f3a2e-0000-7000-8000-0000000000ff', email: 'App-Review@demo.plus-one.io' };
    expect(await run()).toBeInstanceOf(PastGate);
  });

  it('still sends a normal user with an unfinished onboarding there', async () => {
    H.user = { id: '11111111-1111-4111-8111-111111111111', email: 'admin@plusone.test' };
    const out = await run();
    expect(out).toBeInstanceOf(Redirect);
    expect((out as Error).message).toBe('/onboarding');
  });
});
