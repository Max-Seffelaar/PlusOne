import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getMyMemberships, getReportingVenues } from '@/lib/auth/memberships';
import { getSessionUser } from '@/lib/auth/context';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
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

  // Identity + active venue for the live-data layer (PoLiveProvider, STAP 3.2).
  const [user, memberships] = await Promise.all([getSessionUser(), getMyMemberships()]);
  const activeVenueId = await resolveActiveVenueId(memberships).catch(() => null);
  const active = memberships.find((m) => m.venueId === activeVenueId) ?? null;
  const identity: PoIdentity = {
    userId: user?.id ?? '',
    venueId: active?.venueId ?? null,
    venueName: active?.venueName ?? null,
    roles: active?.roles ?? [],
  };

  // Real signed-in identity for the shell (replaces the prototype's hardcoded
  // "Beheerder · Admin · MFA"), so the chrome reflects who is actually logged in.
  const ROLE_LABELS: Record<string, string> = {
    admin: 'Admin',
    finance: 'Finance',
    organizer: 'Organisator',
    user_manager: 'User manager',
    staff: 'Staff',
    doorhost: 'Deur',
  };
  const displayName =
    (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'Account';
  const roleLabel = (active?.roles ?? []).map((r) => ROLE_LABELS[r] ?? r).join(' · ');

  // First-paint viewport hint (corrected client-side by matchMedia) + the live
  // active-venue name for the S0 nav-shell header/sidebar.
  const serverHint = isMobileUA((await headers()).get('user-agent'));

  return (
    <PoLiveProvider identity={identity}>
      <PlusOneApp
        statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
        serverHint={serverHint}
        liveVenueName={active?.venueName ?? undefined}
        userName={displayName}
        userSub={roleLabel}
      />
    </PoLiveProvider>
  );
}
