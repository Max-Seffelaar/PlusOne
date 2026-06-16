import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { DesktopApp } from '@/components/po/desktop/app';
import { getOnboardingState } from '@/lib/auth/onboarding';
import { getSessionUser } from '@/lib/auth/context';
import { getMyMemberships } from '@/lib/auth/memberships';
import { getManageableEvents } from '@/features/events/queries';
import { isManager } from '@/features/auth/roles';
import { venueCapabilities } from '@/features/venues/access';
import {
  DashboardEmptyShell,
  type DashboardNavItem,
} from '@/features/onboarding/components/DashboardEmptyShell';

export const metadata: Metadata = {
  title: 'PLUSONE — Dashboard',
};

export default async function DashboardPage(): Promise<JSX.Element> {
  // A user still in onboarding (no venue yet, or venue created but plan/team not
  // done) belongs in the wizard, not the dashboard (#40).
  const state = await getOnboardingState();
  if (state.step !== 'done') redirect('/onboarding');

  // Fresh venue with no events → the "maak je eerste event" empty state, but
  // inside the real dashboard shell so the menu (events, team, venue) is reachable.
  const events = await getManageableEvents();
  if (events.length === 0) {
    const [user, memberships] = await Promise.all([getSessionUser(), getMyMemberships()]);
    const venueName = memberships[0]?.venueName ?? 'Je venue';
    const userName =
      (user?.user_metadata?.full_name as string | undefined) ?? user?.email ?? 'Account';

    const canSeeReports = memberships.some(
      (m) => m.roles.includes('admin') || m.roles.includes('finance')
    );
    const canManageTeam = memberships.some((m) => isManager(m.roles));
    const canSeeVenue = memberships.some((m) => venueCapabilities(m.roles).viewSettings);

    const nav: DashboardNavItem[] = [
      { href: '/dashboard', label: 'Dashboard', icon: 'grid', active: true },
      { href: '/events', label: 'Events', icon: 'cal' },
    ];
    if (canSeeReports) {
      nav.push(
        { href: '/admin/stats', label: 'Statistieken', icon: 'spark' },
        { href: '/admin/audit', label: 'Audit log', icon: 'history' }
      );
    }
    if (canManageTeam) nav.push({ href: '/admin/team', label: 'Gebruikers', icon: 'users' });
    if (canSeeVenue) nav.push({ href: '/admin/venue', label: 'Venue', icon: 'cog' });

    return <DashboardEmptyShell venueName={venueName} userName={userName} nav={nav} />;
  }

  return <DesktopApp />;
}
