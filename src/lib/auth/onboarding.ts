import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from './context';
import { getMyMemberships } from './memberships';

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

  const memberships = await getMyMemberships();
  const supabase = await createClient();

  if (memberships.length === 0) {
    // An event organizer has no venue membership but already has access to their
    // event (#24) — they must never be pushed into venue creation.
    const { count } = await supabase
      .from('event_organizers')
      .select('event_id', { count: 'exact', head: true })
      .eq('user_id', user.id);
    if ((count ?? 0) > 0) return { step: 'done', venueId: null };
    return { step: 'venue', venueId: null };
  }

  const { data } = await supabase
    .from('venues')
    .select('id, settings, subscriptions(plan_id)')
    .in(
      'id',
      memberships.map((m) => m.venueId)
    );

  const inOnboarding = (data ?? []).find((v) => {
    const onboarding = (v.settings as { onboarding?: OnboardingFlags } | null)?.onboarding;
    return onboarding !== undefined && onboarding.completed !== true;
  });

  if (!inOnboarding) return { step: 'done', venueId: null };

  // subscriptions is 1:1 with venue (unique venue_id), so it resolves to a single
  // row (or null) under detect_one_to_one_relationships.
  const sub = Array.isArray(inOnboarding.subscriptions)
    ? inOnboarding.subscriptions[0]
    : inOnboarding.subscriptions;
  const hasPlan = Boolean(sub?.plan_id);

  return { step: hasPlan ? 'team' : 'plan', venueId: inOnboarding.id };
}
