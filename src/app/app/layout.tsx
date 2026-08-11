import type { JSX, ReactNode } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { PoLiveProvider, type PoIdentity } from '@/features/po/PoLiveProvider';
import { AppShellDataProvider } from '@/components/po/app-shell-data';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { recommendMfaIfDue } from '@/lib/auth/guards';
import { acceptedCurrentTerms } from '@/lib/auth/consent';
import { getMyMemberships, getOrganizerVenues, getReportingVenues } from '@/lib/auth/memberships';
import { getSessionUser } from '@/lib/auth/context';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { createClient } from '@/lib/supabase/server';
import { ROLE_LABELS, VENUE_ROLES } from '@/features/auth/roles';
import { isMobileUA } from '@/lib/ua';

/**
 * Session/identity/venue resolution for the whole `/app` surface, run ONCE per
 * layout instance instead of per screen navigation (G1 fix). Before this split,
 * this work lived in `[[...segments]]/page.tsx`, which — because it read the
 * `searchParams` prop — forced Next to dynamically re-render (and re-fetch over
 * the network) on every query-string-only navigation (door overlay open/close,
 * event picks, tab segments). That broke two things: (1) `PoLiveProvider`'s
 * QueryClient remounted on every screen change, losing cache; (2) the door
 * overlay's open/close — a same-page query-string change — went through an RSC
 * fetch that fails outright when offline (falls back to a hard navigation with
 * the wrong service-worker shell), breaking the door's offline invariant (#25).
 *
 * A layout is the right place to fix both: Next.js keeps a layout mounted
 * across client-side navigations to sibling pages, and (by design) layouts
 * never receive `searchParams` — so nothing here can trigger a re-fetch on a
 * query-string change. `page.tsx` (the only child) now does zero server data
 * work of its own, so query-only navigations stay fully client-side.
 *
 * Trade-off: this layout also never receives the dynamic `segments` param (it
 * sits ABOVE `[[...segments]]` in the route tree — Next only passes a dynamic
 * segment's params to that segment and below), so the one-time consent/MFA
 * `next=` redirect can't reconstruct the exact deep link the user requested;
 * it falls back to bare `/app`. Acceptable: that gate fires once, on first
 * login, and most first logins land on bare `/app` anyway.
 */
export default async function AppLayout({ children }: { children: ReactNode }): Promise<JSX.Element> {
  // Defense in depth (G1 review): the catch-all route now matches paths that
  // used to 404 before every screen had a real URL (e.g. /app/anything.txt),
  // and the middleware matcher's static-extension exclusion skips the auth
  // check for those — so this layout, which runs for every /app/* request,
  // re-verifies the session itself instead of relying solely on middleware.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=${encodeURIComponent('/app')}`);

  // Venue-less users go through onboarding first (#40); the wizard is responsive,
  // so it serves mobile web too.
  const state = await getOnboardingState();
  if (state.step !== 'done') redirect('/onboarding');

  // Best-effort: the caller's reporting venues (admin/finance) gate the
  // Statistieken entry in "Meer". Non-admin or no access → empty → hidden.
  const venues = await getReportingVenues().catch(() => []);

  // Identity + active venue for the live-data layer (PoLiveProvider, STAP 3.2).
  // Access set = real memberships PLUS venues the caller can reach as EXTERNAL CREW
  // only (event-organizer scope, roles:[] — event-scoped access, #24/86ey21vre). A
  // real membership always wins over a crew scope for the same venue. This lets a
  // membership-less crew member land on /app scoped to their event's venue, and a
  // multi-company person switch between every venue they can touch.
  const [memberships, organizerVenues] = await Promise.all([
    getMyMemberships(),
    getOrganizerVenues().catch(() => []),
  ]);
  const memberIds = new Set(memberships.map((m) => m.venueId));
  const accessVenues = [...memberships, ...organizerVenues.filter((v) => !memberIds.has(v.venueId))];
  const activeVenueId = await resolveActiveVenueId(accessVenues).catch(() => null);
  const active = accessVenues.find((m) => m.venueId === activeVenueId) ?? null;
  const identity: PoIdentity = {
    userId: user.id,
    venueId: active?.venueId ?? null,
    venueName: active?.venueName ?? null,
    roles: active?.roles ?? [],
  };

  // Real display name + role label for the shell footer (RLS: own profile).
  const supabase = await createClient();
  const { data: profileRow } = await supabase
    .from('user_profiles')
    .select('full_name, terms_accepted_at, terms_version')
    .eq('id', user.id)
    .maybeSingle();
  // First-login consent gate (#20/#40): accept Terms + Privacy before the app.
  // See the trade-off note above: next= can't carry the exact deep link here.
  // Runs BEFORE the MFA recommendation (UX/IA 9/7, 2026-07-09) — a fresh
  // invitee sees the terms first, a security nudge is not the first thing they
  // meet. This is the live guard for `/app`; `requireAppAccess` in
  // src/lib/auth/guards.ts documents the same order but isn't called from here.
  if (!acceptedCurrentTerms(profileRow)) redirect(`/consent?next=${encodeURIComponent('/app')}`);
  // MFA recommendation (optional since #20 refinement 2026-07-02): skippable
  // nudge for admin/finance without a factor, snooze-aware — never a hard gate.
  await recommendMfaIfDue('/app');
  const userName = profileRow?.full_name || user.email || 'Account';
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
      <AppShellDataProvider
        value={{
          statsAccess: { venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })) },
          myVenues: accessVenues.map((m) => ({ venueId: m.venueId, venueName: m.venueName, roles: m.roles })),
          activeVenueId,
          serverHint,
          liveVenueName: active?.venueName ?? undefined,
          liveUserName: userName,
          liveUserSub: userSub,
        }}
      >
        {children}
      </AppShellDataProvider>
    </PoLiveProvider>
  );
}
