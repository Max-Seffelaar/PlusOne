import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getMyMemberships, getReportingVenues } from '@/lib/auth/memberships';
import { isMobileUA } from '@/lib/ua';

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
  const memberships = await getMyMemberships().catch(() => []);
  // First-paint viewport hint (corrected client-side by matchMedia); live venue
  // name for the shell header/sidebar.
  const serverHint = isMobileUA((await headers()).get('user-agent'));

  return (
    <PlusOneApp
      statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
      serverHint={serverHint}
      liveVenueName={memberships[0]?.venueName}
    />
  );
}
