import type { Metadata } from 'next';
import { requireAppAccess } from '@/lib/auth/guards';
import { createClient } from '@/lib/supabase/server';
import { getDashboardVenues, resolveActiveVenueId } from '@/lib/auth/active-venue';
import { getVenueMembers } from '@/lib/auth/memberships';
import { venueCapabilities } from '@/features/venues/access';
import { VenueSettingsForm } from '@/features/venues/components/VenueSettingsForm';
import { RoleBadges } from '@/features/auth/components/RoleBadges';
import { DefaultQuotaForm } from '@/features/quotas/components/DefaultQuotaForm';

export const metadata: Metadata = { title: 'Venue — PLUSONE' };

export default async function VenueSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}): Promise<JSX.Element> {
  await requireAppAccess('/admin/venue');
  const { venue: venueParam } = await searchParams;

  const dashboardVenues = await getDashboardVenues();
  if (dashboardVenues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Venue</h1>
        <p className="text-dim mt-2">Je hebt geen toegang tot een venue-dashboard.</p>
      </div>
    );
  }

  const activeId = await resolveActiveVenueId(dashboardVenues, venueParam);
  const active = dashboardVenues.find((m) => m.venueId === activeId) ?? dashboardVenues[0];
  const caps = venueCapabilities(active.roles);

  if (!caps.viewSettings) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Venue-instellingen</h1>
        <p className="text-dim mt-2">
          Voor <span className="text-text">{active.venueName}</span> heb je geen toegang tot de
          instellingen — alleen beheerders en financiën zien dit. Wissel eventueel van venue in de
          bovenbalk.
        </p>
      </div>
    );
  }

  const supabase = await createClient();
  const { data: venue } = await supabase
    .from('venues')
    .select('id, name, retention_months')
    .eq('id', active.venueId)
    .maybeSingle();

  const [members, { data: quotaRows }] = await Promise.all([
    getVenueMembers(active.venueId),
    supabase.from('quotas').select('user_id, default_count').eq('venue_id', active.venueId),
  ]);
  const quotaByUser = new Map((quotaRows ?? []).map((q) => [q.user_id, q.default_count]));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <header>
        <h1 className="font-display text-2xl font-bold">Venue-instellingen</h1>
        <p className="text-dim mt-1 text-sm">
          Naam, bewaartermijn en toelages voor <span className="text-text">{active.venueName}</span>
          {!caps.editSettings && <span className="text-faint"> · alleen-lezen</span>}.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="label">Instellingen</h2>
        <VenueSettingsForm
          venueId={active.venueId}
          name={venue?.name ?? active.venueName}
          retentionMonths={venue?.retention_months ?? 12}
          canEdit={caps.editSettings}
        />
      </section>

      {caps.viewQuota && (
        <section className="flex flex-col gap-3">
          <h2 className="label">Standaard-toelages ({members.length})</h2>
          <p className="text-faint text-sm">
            Het standaard aantal gastenlijstplekken per persoon voor deze venue. Per event kan dit
            worden overschreven. Beheerders en organisatoren zijn uitgezonderd van een persoonlijk
            quotum.
          </p>
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const exempt = member.roles.includes('admin');
              const count = quotaByUser.get(member.userId) ?? 0;
              return (
                <li
                  key={member.userId}
                  className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">{member.fullName}</p>
                    <p className="text-faint text-sm">{member.email}</p>
                    <div className="mt-1.5">
                      <RoleBadges roles={member.roles} />
                    </div>
                  </div>
                  {exempt ? (
                    <span className="text-faint text-xs">Uitgezonderd van quotum</span>
                  ) : caps.editQuota ? (
                    <DefaultQuotaForm
                      venueId={active.venueId}
                      userId={member.userId}
                      defaultCount={count}
                    />
                  ) : (
                    <span className="text-dim text-sm">
                      <span className="font-display text-text text-lg font-bold">{count}</span> plekken
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
