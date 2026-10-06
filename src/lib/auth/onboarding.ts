import 'server-only';

import { getSessionUser } from './context';
import { getMyMemberships, getMyVenueOnboardingStates, getOrganizerVenues } from './memberships';

// Self-service onboarding (#40). A new owner is provisioned invite-only and has
// ZERO memberships on first login; the flow lets them create their first venue,
// pick a plan, invite their team, then create the first event.

export type OnboardingStep = 'venue' | 'plan' | 'team' | 'done';

export interface OnboardingState {
  step: OnboardingStep;
  /** The in-onboarding venue once it exists; null while still on the venue step. */
  venueId: string | null;
}

interface OnboardingFlags {
  completed?: boolean;
}

// Derive where the user is, from data, so the wizard is resumable and the gate
// is cheap:
//   no access anywhere                    → 'venue'  (create the company)
//   own venue, onboarding not completed,
//     subscription has no plan yet        → 'plan'
//     subscription has a plan             → 'team'
//   otherwise                             → 'done'
//
// Only venues created via the flow carry settings.onboarding; seeded/invited
// venues have no such key and never count as in-onboarding, so an invited member
// of an existing venue is immediately 'done' (never bounced into the wizard). A
// membership-less event organizer (#24) already has access and is 'done' too.
export async function getOnboardingState(): Promise<OnboardingState> {
  const user = await getSessionUser();
  if (!user) return { step: 'venue', venueId: null };

  // All three reads are per-request cached (Snelheid P1): the `/app` layout
  // fetches them in one parallel wave, so this gate adds no round-trip.
  const [memberships, venueStates] = await Promise.all([getMyMemberships(), getMyVenueOnboardingStates()]);

  if (memberships.length === 0) {
    // An event organizer has no venue membership but already has access to their
    // event (#24) — they must never be pushed into venue creation.
    const organizerVenues = await getOrganizerVenues();
    if (organizerVenues.length > 0) return { step: 'done', venueId: null };
    return { step: 'venue', venueId: null };
  }

  const inOnboarding = venueStates.find((v) => {
    const onboarding = (v.settings as { onboarding?: OnboardingFlags } | null)?.onboarding;
    return onboarding !== undefined && onboarding.completed !== true;
  });

  if (!inOnboarding) return { step: 'done', venueId: null };

  return { step: inOnboarding.planId ? 'team' : 'plan', venueId: inOnboarding.venueId };
}
