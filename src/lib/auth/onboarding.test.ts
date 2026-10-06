import { beforeEach, describe, expect, it, vi } from 'vitest';

// getOnboardingState now derives the step from the per-request cached
// membership read (venue settings + plan embedded) instead of its own
// venue_memberships + venues reads (Snelheid P1). These cases pin that the
// derivation is unchanged: no access → 'venue', crew-only → 'done',
// in-onboarding venue → 'plan'/'team', seeded/invited/completed → 'done'.

const H = vi.hoisted(() => ({
  user: { id: 'u1' } as { id: string } | null,
  memberships: [] as Array<{
    venueId: string;
    venueName: string;
    roles: string[];
    venueSettings: unknown;
    planId: string | null;
  }>,
  organizerVenues: [] as Array<{ venueId: string }>,
}));

vi.mock('./context', () => ({ getSessionUser: async () => H.user }));
vi.mock('./memberships', () => ({
  getMyMembershipsWithVenueState: async () => H.memberships,
  getOrganizerVenues: async () => H.organizerVenues,
}));

import { getOnboardingState } from './onboarding';

function member(venueId: string, venueSettings: unknown, planId: string | null = null) {
  return { venueId, venueName: venueId, roles: ['admin'], venueSettings, planId };
}

beforeEach(() => {
  H.user = { id: 'u1' };
  H.memberships = [];
  H.organizerVenues = [];
});

describe('getOnboardingState', () => {
  it('signed out → venue step', async () => {
    H.user = null;
    expect(await getOnboardingState()).toEqual({ step: 'venue', venueId: null });
  });

  it('no membership and no organizer scope → venue step', async () => {
    expect(await getOnboardingState()).toEqual({ step: 'venue', venueId: null });
  });

  it('membership-less event organizer (#24) is done, never pushed into venue creation', async () => {
    H.organizerVenues = [{ venueId: 'v9' }];
    expect(await getOnboardingState()).toEqual({ step: 'done', venueId: null });
  });

  it('seeded/invited venue without settings.onboarding is done', async () => {
    H.memberships = [member('v1', { door: {} }), member('v2', null)];
    expect(await getOnboardingState()).toEqual({ step: 'done', venueId: null });
  });

  it('completed onboarding is done', async () => {
    H.memberships = [member('v1', { onboarding: { completed: true } }, 'pro')];
    expect(await getOnboardingState()).toEqual({ step: 'done', venueId: null });
  });

  it('unfinished onboarding without a plan → plan step on that venue', async () => {
    H.memberships = [member('v0', null), member('v1', { onboarding: { completed: false } })];
    expect(await getOnboardingState()).toEqual({ step: 'plan', venueId: 'v1' });
  });

  it('unfinished onboarding with a plan → team step', async () => {
    H.memberships = [member('v1', { onboarding: {} }, 'pro')];
    expect(await getOnboardingState()).toEqual({ step: 'team', venueId: 'v1' });
  });
});
