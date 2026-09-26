import type { JSX } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guards';
import { requireConsent } from '@/lib/auth/consent';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { isDemoReviewUser } from '@/features/auth/review-window';
import { OnboardingWizard } from '@/features/onboarding/components/OnboardingWizard';

export const metadata: Metadata = {
  title: 'Get started · PlusOne',
};

// Self-service onboarding (#40). Reachable before MFA/venue exist, so it uses the
// plain requireUser guard (NOT requireAppAccess, which would force the MFA step
// and loop). A finished user is sent to the app.
export default async function OnboardingPage(): Promise<JSX.Element> {
  const user = await requireUser('/onboarding');
  // Accept Terms + Privacy before the onboarding wizard (#20/#40).
  await requireConsent(user.id, '/onboarding');
  const state = await getOnboardingState();
  if (state.step === 'done') redirect('/app');

  const owner = {
    name: (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Account',
    email: user.email ?? '',
  };

  // The store-review demo account (86ey6bfug): the /app layout never sends it
  // here, but a direct visit with an unfinished demo venue still renders the
  // wizard, so every step that would open a form shows the refusal instead.
  const demoAccount = isDemoReviewUser(user);

  return (
    <OnboardingWizard initialStep={state.step} venueId={state.venueId} owner={owner} demoAccount={demoAccount} />
  );
}
