import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { hasDashboardAccess, venueCapabilities } from '@/features/venues/access';
import { ROLE_LABELS } from '@/features/auth/roles';
import { PendingInvitesBanner } from '@/features/auth/components/PendingInvitesBanner';
import { DashboardShell, type ShellNavItem } from '@/components/po/desktop/dashboard-shell';

// Authenticated app shell. requireAppAccess enforces the MFA policy before any
// child renders; the PLUSONE desktop sidebar adapts to the user's roles and lets
// multi-venue users switch the active venue (decision #1).
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<JSX.Element> {
  const ctx = await requireAppAccess();
  const memberships = await getMyMemberships();

  const dashboardVenues = memberships.filter((m) => hasDashboardAccess(m.roles));
  const activeVenueId = await resolveActiveVenueId(dashboardVenues);
  const activeMembership = dashboardVenues.find((m) => m.venueId === activeVenueId);

  const canSeeTeam = dashboardVenues.length > 0; // admin/user_manager/finance
  const canSeeVenue = memberships.some((m) => venueCapabilities(m.roles).viewSettings); // admin/finance
  const isAdminSomewhere = memberships.some((m) => m.roles.includes('admin'));

  // Real pages first, then the not-yet-built sections (fase 6/10) as "binnenkort".
  const navItems: ShellNavItem[] = [
    { href: '/dashboard', label: 'Dashboard', icon: 'grid' },
    ...(canSeeTeam ? [{ href: '/admin/team', label: 'Gebruikers', icon: 'users' as const }] : []),
    ...(canSeeVenue ? [{ href: '/admin/venue', label: 'Venue', icon: 'building' as const }] : []),
    ...(isAdminSomewhere ? [{ href: '/admin/sessions', label: 'Sessies', icon: 'lock' as const }] : []),
    { href: '#', label: 'Events', icon: 'cal', soon: true },
    { href: '#', label: 'Statistieken', icon: 'spark', soon: true },
    { href: '#', label: 'Audit log', icon: 'history', soon: true },
  ];

  const displayName =
    (ctx.user.user_metadata?.full_name as string | undefined) ?? ctx.user.email ?? 'Account';
  const roleLine = activeMembership
    ? activeMembership.roles.map((r) => ROLE_LABELS[r]).join(' · ') + (ctx.isAal2 ? ' · MFA' : '')
    : (ctx.user.email ?? '');

  return (
    <DashboardShell
      userName={displayName}
      roleLine={roleLine}
      venues={dashboardVenues.map((m) => ({ venueId: m.venueId, venueName: m.venueName }))}
      activeVenueId={activeVenueId}
      navItems={navItems}
    >
      <PendingInvitesBanner />
      {children}
    </DashboardShell>
  );
}
