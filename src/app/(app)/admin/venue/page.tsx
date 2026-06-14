import type { Metadata } from 'next';
import Link from 'next/link';
import { requireAppAccess } from '@/lib/auth/guards';
import { getMyMemberships } from '@/lib/auth/memberships';
import { createClient } from '@/lib/supabase/server';
import { RetentionForm } from '@/features/venues/components/RetentionForm';

export const metadata: Metadata = { title: 'Venue — PLUSONE' };

// Real admin surface for the "AVG & bewaartermijn" section of the mock
// VenueSettings screen (decision #38: mirror the mock with real data, do not
// rebuild it). Wired to venues.retention_months (#16/#29); the daily
// run_privacy_retention() job acts on this value.
export default async function VenueSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ venue?: string }>;
}): Promise<JSX.Element> {
  await requireAppAccess('/admin/venue');
  const { venue: venueParam } = await searchParams;

  const memberships = await getMyMemberships();
  const adminVenues = memberships.filter((m) => m.roles.includes('admin'));

  if (adminVenues.length === 0) {
    return (
      <div className="card mx-auto max-w-3xl">
        <h1 className="font-display text-2xl font-bold">Venue</h1>
        <p className="text-dim mt-2">Alleen een venue-admin kan venue-instellingen beheren.</p>
      </div>
    );
  }

  const active = adminVenues.find((m) => m.venueId === venueParam) ?? adminVenues[0];

  const supabase = await createClient();
  const { data: venue } = await supabase
    .from('venues')
    .select('id, name, retention_months')
    .eq('id', active.venueId)
    .maybeSingle();

  const retention = venue?.retention_months ?? 12;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl font-bold">Venue</h1>
        <p className="text-dim mt-1 text-sm">
          Instellingen voor <span className="text-text">{active.venueName}</span>.
        </p>
      </header>

      {adminVenues.length > 1 && (
        <nav className="flex flex-wrap gap-2" aria-label="Venue kiezen">
          {adminVenues.map((m) => (
            <Link
              key={m.venueId}
              href={`/admin/venue?venue=${m.venueId}`}
              className={`rounded-btn border px-3 py-1.5 text-sm transition-colors ${
                m.venueId === active.venueId
                  ? 'border-acc bg-acc-dim text-text'
                  : 'border-line text-dim hover:border-acc'
              }`}
            >
              {m.venueName}
            </Link>
          ))}
        </nav>
      )}

      <section className="card flex flex-col gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">AVG &amp; bewaartermijn</h2>
          <p className="text-dim mt-1 text-sm">
            Gastdata wordt na deze termijn automatisch geanonimiseerd tot “Gast #X” — naam, e-mail en
            telefoon verdwijnen. Het audit log blijft intact. Een dagelijkse job voert dit per event
            uit, gerekend vanaf de eventdatum.
          </p>
        </div>
        <RetentionForm venueId={active.venueId} current={retention} />
      </section>
    </div>
  );
}
