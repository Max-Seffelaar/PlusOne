import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getVenueMembers, getPendingInvitesForVenue } from '@/lib/auth/memberships';
import { getDashboardVenues, resolveActiveVenueId } from '@/lib/auth/active-venue';
import { venueCapabilities } from '@/features/venues/access';
import { DCard } from '@/components/po/desktop/kit';
import { Icon, type IconName } from '@/components/po/icon';
import { getManageableEvents } from '@/features/events/queries';
import { FirstEventEmpty } from '@/features/onboarding/components/FirstEventEmpty';

export const metadata: Metadata = { title: 'Dashboard — PLUSONE' };

const press = 'transition-[filter,transform] hover:brightness-[1.08] active:scale-[0.99]';

export default async function DashboardHome(): Promise<JSX.Element> {
  const ctx = await requireAppAccess('/dashboard');
  const dashboardVenues = await getDashboardVenues();

  if (dashboardVenues.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Welkom</h1>
        <p className="text-dim mt-2">
          Je hebt nog geen venue-dashboard. Vraag een beheerder om je toegang te geven.
        </p>
      </div>
    );
  }

  const activeId = await resolveActiveVenueId(dashboardVenues);
  const active = dashboardVenues.find((m) => m.venueId === activeId) ?? dashboardVenues[0];
  const caps = venueCapabilities(active.roles);

  // Fresh venue with no events yet → the #19/#40 "maak je eerste event" empty
  // state, rendered inside this unified sidebar shell (replaces the standalone
  // DashboardEmptyShell that #19 used while the sidebar lived outside (app)).
  const events = await getManageableEvents();
  if (events.length === 0) {
    return <FirstEventEmpty venueName={active.venueName} />;
  }

  const [members, invites] = await Promise.all([
    getVenueMembers(active.venueId),
    getPendingInvitesForVenue(active.venueId),
  ]);

  const kpis = [
    { v: String(members.length), l: 'Teamleden', icon: 'users' as IconName },
    { v: String(invites.length), l: 'Open uitnodigingen', icon: 'mail' as IconName, acc: invites.length > 0 },
    { v: String(dashboardVenues.length), l: dashboardVenues.length === 1 ? 'Venue' : 'Venues', icon: 'building' as IconName },
  ];

  const canSeeReports = active.roles.includes('admin') || active.roles.includes('finance');
  const links: { href: string; title: string; sub: string; icon: IconName; show: boolean }[] = [
    { href: '/events', title: 'Events', sub: 'Gastenlijsten, deur & lijst-lock', icon: 'cal', show: true },
    { href: '/admin/team', title: 'Gebruikers', sub: 'Leden, rollen & uitnodigingen', icon: 'users', show: caps.viewTeam },
    { href: '/admin/venue', title: 'Venue-instellingen', sub: 'Bedrijfsgegevens, bewaartermijn & toelages', icon: 'building', show: caps.viewSettings },
    { href: '/admin/stats', title: 'Statistieken', sub: 'Opkomst & instroom per event', icon: 'spark', show: canSeeReports },
    { href: '/admin/audit', title: 'Audit log', sub: 'Wie deed wat, wanneer', icon: 'history', show: canSeeReports },
    { href: '/admin/sessions', title: 'Sessies', sub: 'Actieve apparaten & remote logout', icon: 'lock', show: active.roles.includes('admin') },
  ];

  return (
    <div className="flex max-w-5xl flex-col gap-[22px]">
      <header>
        <h1 className="font-display text-[26px] font-extrabold tracking-[-0.02em]">Dashboard</h1>
        <p className="text-faint mt-0.5 text-[13.5px]">
          {active.venueName} · welkom terug, {ctx.user.user_metadata?.full_name ?? ctx.user.email}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <DCard key={k.l} className="p-5">
            <div className="flex items-start justify-between">
              <div className={`font-display text-[38px] font-extrabold leading-none tracking-[-0.02em] ${k.acc ? 'text-acc' : 'text-text'}`}>
                {k.v}
              </div>
              <span className={`flex h-9 w-9 items-center justify-center rounded-[11px] border ${k.acc ? 'border-transparent bg-acc-dim text-acc' : 'border-line bg-elev2 text-dim'}`}>
                <Icon name={k.icon} size={18} />
              </span>
            </div>
            <div className="mt-[14px] text-[14.5px] font-semibold">{k.l}</div>
          </DCard>
        ))}
      </div>

      <div>
        <p className="label mb-3">Snel naar</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {links.filter((l) => l.show).map((l) => (
            <Link key={l.href} href={l.href} className={press}>
              <DCard className="flex h-full flex-col gap-3 p-5">
                <span className="bg-elev2 border-line text-acc flex h-10 w-10 items-center justify-center rounded-[12px] border">
                  <Icon name={l.icon} size={20} />
                </span>
                <div>
                  <div className="font-display text-[16px] font-bold">{l.title}</div>
                  <div className="text-faint mt-0.5 text-[13px] leading-[1.4]">{l.sub}</div>
                </div>
              </DCard>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
