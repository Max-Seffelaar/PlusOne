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
    .select(
      'id, name, retention_months, company_name, kvk_number, vat_number, finance_email, address_line, postal_code, city, country, default_personal_quota'
    )
    .eq('id', active.venueId)
    .maybeSingle();
  const venueDefaultQuota = venue?.default_personal_quota ?? 0;

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
          Bedrijfsgegevens, bewaartermijn en toelages voor{' '}
          <span className="text-text">{active.venueName}</span>
          {!caps.editSettings && <span className="text-faint"> · alleen-lezen</span>}.
        </p>
      </header>

      <VenueSettingsForm
        venueId={active.venueId}
        canEdit={caps.editSettings}
        values={{
          name: venue?.name ?? active.venueName,
          retentionMonths: venue?.retention_months ?? 12,
          companyName: venue?.company_name ?? null,
          kvkNumber: venue?.kvk_number ?? null,
          vatNumber: venue?.vat_number ?? null,
          financeEmail: venue?.finance_email ?? null,
          addressLine: venue?.address_line ?? null,
          postalCode: venue?.postal_code ?? null,
          city: venue?.city ?? null,
          country: venue?.country ?? 'NL',
          defaultPersonalQuota: venueDefaultQuota,
        }}
      />

      {caps.viewQuota && (
        <section className="flex flex-col gap-3">
          <h2 className="label">Toelages per lid ({members.length})</h2>
          <p className="text-faint text-sm">
            Standaard krijgt elk lid <span className="text-text">{venueDefaultQuota}</span>{' '}
            gastenlijstplekken (in te stellen hierboven). Hieronder overschrijf je dat per persoon;
            per event kan het ook nog worden aangepast. Beheerders en organisatoren zijn uitgezonderd
            van een persoonlijk quotum.
          </p>
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const exempt = member.roles.includes('admin');
              const hasOverride = quotaByUser.has(member.userId);
              const effective = quotaByUser.get(member.userId) ?? venueDefaultQuota;
              return (
                <li
                  key={member.userId}
                  className="card flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold">{member.fullName}</p>
                    <p className="text-faint text-sm">
                      {member.jobTitle ? `${member.jobTitle} · ` : ''}
                      {member.email}
                    </p>
                    <div className="mt-1.5">
                      <RoleBadges roles={member.roles} />
                    </div>
                  </div>
                  {exempt ? (
                    <span className="text-faint text-xs">Uitgezonderd van quotum</span>
                  ) : caps.editQuota ? (
                    <div className="flex flex-col items-end gap-1">
                      <DefaultQuotaForm
                        venueId={active.venueId}
                        userId={member.userId}
                        defaultCount={effective}
                      />
                      {!hasOverride && (
                        <span className="text-faint text-xs">erft venue-standaard ({venueDefaultQuota})</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-dim text-sm">
                      <span className="font-display text-text text-lg font-bold">{effective}</span>{' '}
                      plekken{!hasOverride && <span className="text-faint"> · venue-standaard</span>}
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
