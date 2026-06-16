import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { getOnboardingState } from '@/lib/auth/onboarding';

export const metadata: Metadata = {
  title: 'PLUSONE — Gastenlijst',
};

export default async function AppPage(): Promise<JSX.Element> {
  // Venue-less users go through onboarding first (#40); the wizard is responsive,
  // so it serves mobile web too.
  const state = await getOnboardingState();
  if (state.step !== 'done') redirect('/onboarding');

  return <PlusOneApp />;
}
