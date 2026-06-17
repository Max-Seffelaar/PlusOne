import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getReportingVenues } from '@/lib/auth/memberships';

export const metadata: Metadata = {
  title: 'PLUSONE — Gastenlijst',
};

export default async function AppPage(): Promise<JSX.Element> {
  // Venue-less users go through onboarding first (#40); the wizard is responsive,
  // so it serves mobile web too.
  const state = await getOnboardingState();
  if (state.step !== 'done') redirect('/onboarding');

  // Best-effort: the caller's reporting venues (admin/finance) gate the
  // Statistieken entry in "Meer". Non-admin or no access → empty → hidden.
  const venues = await getReportingVenues().catch(() => []);
  return (
    <PlusOneApp
      statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
    />
  );
}
