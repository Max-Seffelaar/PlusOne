import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getMyMemberships, getReportingVenues } from '@/lib/auth/memberships';
import { getSessionUser } from '@/lib/auth/context';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, VENUE_ROLES, requiresMfa } from '@/features/auth/roles';
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

  // Real display name + role label for the shell footer (RLS: own profile).
  const supabase = await createClient();
  const { data: profileRow } = user
    ? await supabase.from('user_profiles').select('full_name').eq('id', user.id).maybeSingle()
    : { data: null };
  const userName = profileRow?.full_name || user?.email || 'Account';
  const roleLabel =
    active && active.roles.length > 0
      ? VENUE_ROLES.filter((r) => active.roles.includes(r))
          .map((r) => ROLE_LABELS[r])
          .join(' · ')
      : 'Lid';
  const userSub = active && requiresMfa(active.roles) ? `${roleLabel} · MFA` : roleLabel;

  // First-paint viewport hint (corrected client-side by matchMedia) + the live
  // active-venue name for the S0 nav-shell header/sidebar.
  const serverHint = isMobileUA((await headers()).get('user-agent'));

  return (
    <PoLiveProvider identity={identity}>
      <PlusOneApp
        statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
        serverHint={serverHint}
        liveVenueName={active?.venueName ?? undefined}
        liveUserName={userName}
        liveUserSub={userSub}
        myVenues={memberships.map((m) => ({ id: m.venueId, name: m.venueName, roles: m.roles }))}
        activeVenueId={activeVenueId}
      />
    </PoLiveProvider>
  );
}
