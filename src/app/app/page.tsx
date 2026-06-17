import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getReportingVenues, getMyMemberships } from '@/lib/auth/memberships';
import { getSessionUser } from '@/lib/auth/context';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';

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

  // Identity + active venue for the live-data layer (PoLiveProvider). No screen
  // consumes it yet — STAP 3.2 is infra; it primes the provider for STAP 3.3+.
  const [user, memberships] = await Promise.all([getSessionUser(), getMyMemberships()]);
  const activeVenueId = await resolveActiveVenueId(memberships).catch(() => null);
  const active = memberships.find((m) => m.venueId === activeVenueId) ?? null;
  const identity: PoIdentity = {
    userId: user?.id ?? '',
    venueId: active?.venueId ?? null,
    venueName: active?.venueName ?? null,
    roles: active?.roles ?? [],
  };

  return (
    <PoLiveProvider identity={identity}>
      <PlusOneApp
        statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
      />
    </PoLiveProvider>
  );
}
