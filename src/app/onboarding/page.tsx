import type { JSX } from 'react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth/guards';
import { requireConsent } from '@/lib/auth/consent';
import { getOnboardingState } from '@/lib/auth/onboarding';
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

  return <OnboardingWizard initialStep={state.step} venueId={state.venueId} owner={owner} />;
}
