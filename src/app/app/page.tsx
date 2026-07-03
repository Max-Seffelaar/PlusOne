import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PlusOneApp } from '@/components/po/app';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { recommendMfaIfDue } from '@/lib/auth/guards';
import { acceptedCurrentTerms } from '@/lib/auth/consent';
import { getMyMemberships, getOrganizerVenues, getReportingVenues } from '@/lib/auth/memberships';
import { getSessionUser } from '@/lib/auth/context';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, VENUE_ROLES } from '@/features/auth/roles';
import { isMobileUA } from '@/lib/ua';

export const metadata: Metadata = {
  title: 'Guest list · PlusOne',
};

export default async function AppPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<JSX.Element> {
  // Venue-less users go through onboarding first (#40); the wizard is responsive,
  // so it serves mobile web too.
  const state = await getOnboardingState();
  if (state.step !== 'done') redirect('/onboarding');

  // Preserve the ?new=event onboarding intent through the consent/MFA detours.
  const currentPath = (await searchParams).new === 'event' ? '/app?new=event' : '/app';

  // Best-effort: the caller's reporting venues (admin/finance) gate the
  // Statistieken entry in "Meer". Non-admin or no access → empty → hidden.
  const venues = await getReportingVenues().catch(() => []);

  // Identity + active venue for the live-data layer (PoLiveProvider, STAP 3.2).
  // Access set = real memberships PLUS venues the caller can reach as EXTERNAL CREW
  // only (event-organizer scope, roles:[] — event-scoped access, #24/86ey21vre). A
  // real membership always wins over a crew scope for the same venue. This lets a
  // membership-less crew member land on /app scoped to their event's venue, and a
  // multi-company person switch between every venue they can touch.
  const [user, memberships, organizerVenues] = await Promise.all([
    getSessionUser(),
    getMyMemberships(),
    getOrganizerVenues().catch(() => []),
  ]);
  const memberIds = new Set(memberships.map((m) => m.venueId));
  const accessVenues = [...memberships, ...organizerVenues.filter((v) => !memberIds.has(v.venueId))];
  const activeVenueId = await resolveActiveVenueId(accessVenues).catch(() => null);
  const active = accessVenues.find((m) => m.venueId === activeVenueId) ?? null;
  const identity: PoIdentity = {
    userId: user?.id ?? '',
    venueId: active?.venueId ?? null,
    venueName: active?.venueName ?? null,
    roles: active?.roles ?? [],
  };

  // Real display name + role label for the shell footer (RLS: own profile).
  const supabase = await createClient();
  const { data: profileRow } = user
    ? await supabase
        .from('user_profiles')
        .select('full_name, terms_accepted_at, terms_version')
        .eq('id', user.id)
        .maybeSingle()
    : { data: null };
  // First-login consent gate (#20/#40): accept Terms + Privacy before the app.
  if (user && !acceptedCurrentTerms(profileRow)) redirect(`/consent?next=${encodeURIComponent(currentPath)}`);
  // MFA recommendation (optional since #20 refinement 2026-07-02): skippable
  // nudge for admin/finance without a factor, snooze-aware — never a hard gate.
  await recommendMfaIfDue(currentPath);
  const userName = profileRow?.full_name || user?.email || 'Account';
  const roleLabel =
    active && active.roles.length > 0
      ? VENUE_ROLES.filter((r) => active.roles.includes(r))
          .map((r) => ROLE_LABELS[r])
          .join(' · ')
      : active
        ? 'External crew'
        : 'Member';
  const userSub = roleLabel;

  // First-paint viewport hint (corrected client-side by matchMedia) + the live
  // active-venue name for the S0 nav-shell header/sidebar.
  const serverHint = isMobileUA((await headers()).get('user-agent'));

  return (
    <PoLiveProvider identity={identity}>
      <PlusOneApp
        statsAccess={{ venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) }}
        myVenues={accessVenues.map((m) => ({ venueId: m.venueId, venueName: m.venueName, roles: m.roles }))}
        activeVenueId={activeVenueId}
        serverHint={serverHint}
        liveVenueName={active?.venueName ?? undefined}
        liveUserName={userName}
        liveUserSub={userSub}
      />
    </PoLiveProvider>
  );
}
