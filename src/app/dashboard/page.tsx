import type { Metadata } from 'next';
import { DesktopApp } from '@/components/po/desktop/app';
import { requireAppAccess } from '@/lib/auth/guards';
import { getReportingVenues } from '@/lib/auth/memberships';
import { resolveActiveVenueId } from '@/lib/auth/active-venue';
import { fetchEventStats, fetchVenueEvents, fetchVenueStats } from '@/features/stats/queries';

export const metadata: Metadata = {
  title: 'PLUSONE — Dashboard',
};

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}): Promise<JSX.Element> {
  // The polished desktop dashboard now shows real venue data, so it must be gated
  // (it previously rendered the public mock). Reporting access = admin/finance.
  await requireAppAccess('/dashboard');
  const venues = await getReportingVenues();
  if (venues.length === 0) return <DesktopApp statsBootstrap={null} />;

  const { venue: venueOverride } = await searchParams;
  const activeId = await resolveActiveVenueId(venues, venueOverride);
  const active = venues.find((v) => v.venueId === activeId) ?? venues[0];

  // Org-level KPIs (all-time) need no event; the picker drives the per-event detail.
  const [venueStats, events] = await Promise.all([
    fetchVenueStats(active.venueId, null, null),
    fetchVenueEvents(active.venueId),
  ]);
  const selectedEventId = events[0]?.id ?? null;
  const eventStats = selectedEventId ? await fetchEventStats(selectedEventId) : null;

  return (
    <DesktopApp
      statsBootstrap={{
        venueId: active.venueId,
        venueName: active.venueName,
        venues: venues.map((v) => ({ venueId: v.venueId, venueName: v.venueName })),
        venueStats,
        events,
        selectedEventId,
        eventStats,
      }}
    />
  );
}
