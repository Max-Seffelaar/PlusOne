import { redirect } from 'next/navigation';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { hasDashboardAccess, venueCapabilities } from '@/features/venues/access';
import { isManager } from '@/features/auth/roles';
import { PendingInvitesBanner } from '@/features/auth/components/PendingInvitesBanner';
import { DashSidebar, type SidebarNavItem } from '@/components/po/desktop/DashSidebar';

// Authenticated app shell — one sidebar for dashboard, events and the admin
// pages (no more shell-switch between them). requireAppAccess enforces the MFA
// policy before any child renders; the nav adapts to the user's roles and lets
// multi-venue users switch the active venue (decision #1).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess();

  // A user with no venue yet (and no event-organizer scope) belongs in the
  // self-service onboarding flow (#40a), not the empty app shell.
  const onboarding = await getOnboardingState();
  if (onboarding.step !== 'done') redirect('/onboarding');

  const memberships = await getMyMemberships();
  const dashboardVenues = memberships.filter((m) => hasDashboardAccess(m.roles));
  const activeVenueId = await resolveActiveVenueId(dashboardVenues);

  const canManageTeam = memberships.some((m) => isManager(m.roles));
  const canSeeVenue = memberships.some((m) => venueCapabilities(m.roles).viewSettings); // admin/finance
  const isAdminSomewhere = memberships.some((m) => m.roles.includes('admin'));
  const canSeeReports = memberships.some(
    (m) => m.roles.includes('admin') || m.roles.includes('finance')
  );

  const displayName =
    (ctx.user.user_metadata?.full_name as string | undefined) ?? ctx.user.email ?? 'Account';
  const activeVenue = dashboardVenues.find((m) => m.venueId === activeVenueId) ?? dashboardVenues[0];
  const venueName = activeVenue?.venueName ?? memberships[0]?.venueName ?? 'Venue';

  const nav: SidebarNavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
    { href: '/events', label: 'Events', icon: 'cal' },
  ];
  if (canSeeReports) {
    nav.push(
      { href: '/admin/stats', label: 'Statistieken', icon: 'spark' },
      { href: '/admin/overview', label: 'Overzicht', icon: 'note' },
      { href: '/admin/audit', label: 'Audit log', icon: 'history' }
    );
  }
  if (canManageTeam) nav.push({ href: '/admin/team', label: 'Gebruikers', icon: 'users' });
  if (canSeeVenue) nav.push({ href: '/admin/venue', label: 'Venue', icon: 'cog' });
  if (isAdminSomewhere) nav.push({ href: '/admin/sessions', label: 'Sessies', icon: 'lock' });
  nav.push({ href: '/settings/profile', label: 'Profiel', icon: 'user' });

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <DashSidebar
        venueName={venueName}
        userName={displayName}
        nav={nav}
        venues={dashboardVenues.map((m) => ({ venueId: m.venueId, venueName: m.venueName }))}
        activeVenueId={activeVenueId}
      />
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl px-8 py-7">
          <PendingInvitesBanner />
          {children}
        </div>
      </main>
    </div>
  );
}
