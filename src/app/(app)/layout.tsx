import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { hasDashboardAccess, venueCapabilities } from '@/features/venues/access';
import { isManager } from '@/features/auth/roles';
import { PendingInvitesBanner } from '@/features/auth/components/PendingInvitesBanner';
import { SignOutButton } from '@/features/auth/components/SignOutButton';
import { VenueSwitcher } from '@/features/venues/components/VenueSwitcher';

// Authenticated app shell. requireAppAccess enforces the MFA policy before any
// child renders; the nav adapts to the user's roles and lets multi-venue users
// switch the active venue (decision #1). Fase 10 added the reports/audit nav.
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
  // Admin + the read-only Finance role get reports & the audit log (spec §2).
  const canSeeReports = memberships.some(
    (m) => m.roles.includes('admin') || m.roles.includes('finance')
  );

  const displayName =
    (ctx.user.user_metadata?.full_name as string | undefined) ?? ctx.user.email ?? 'Account';

  return (
    <div className="min-h-screen">
      <header className="border-line bg-bg/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-4 py-3">
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/dashboard" className="font-display text-lg font-extrabold tracking-tight">
              PLUSONE
            </Link>
            <Link href="/dashboard" className="text-dim hover:text-text transition-colors">
              Dashboard
            </Link>
            <Link href="/events" className="text-dim hover:text-text transition-colors">
              Events
            </Link>
            {canSeeReports && (
              <>
                <Link href="/admin/stats" className="text-dim hover:text-text transition-colors">
                  Statistieken
                </Link>
                <Link href="/admin/overview" className="text-dim hover:text-text transition-colors">
                  Overzicht
                </Link>
                <Link href="/admin/audit" className="text-dim hover:text-text transition-colors">
                  Audit log
                </Link>
              </>
            )}
            {canSeeVenue && (
              <Link href="/admin/venue" className="text-dim hover:text-text transition-colors">
                Venue
              </Link>
            )}
            {canManageTeam && (
              <Link href="/admin/team" className="text-dim hover:text-text transition-colors">
                Team
              </Link>
            )}
            {isAdminSomewhere && (
              <Link href="/admin/sessions" className="text-dim hover:text-text transition-colors">
                Sessies
              </Link>
            )}
            {isAdminSomewhere && (
              <Link href="/admin/venue" className="text-dim hover:text-text transition-colors">
                Venue
              </Link>
            )}
            <Link href="/settings/profile" className="text-dim hover:text-text transition-colors">
              Profiel
            </Link>
          </nav>
          <div className="flex items-center gap-3">
            <VenueSwitcher
              venues={dashboardVenues.map((m) => ({ venueId: m.venueId, venueName: m.venueName }))}
              activeVenueId={activeVenueId}
            />
            <span className="text-faint hidden text-sm sm:inline">{displayName}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <PendingInvitesBanner />
        {children}
      </main>
    </div>
  );
}
