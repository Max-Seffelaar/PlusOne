import { notFound, redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface PageProps {
  params: Promise<{ 'venue-id': string }>;
}

export const metadata = {
  title: 'Evenementen — PLUSONE',
};

export default async function EventsPage({ params }: PageProps) {
  const { 'venue-id': venueId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { allowed, membership } = await checkVenueMembership(venueId, ['admin']);
  if (!allowed) {
    notFound();
  }

  const supabase = await getServerSupabaseClient();

  // Get venue
  const { data: venue } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (!venue) {
    notFound();
  }

  // Get all events
  const { data: events = [] } = await supabase
    .from('events')
    .select('*')
    .eq('venue_id', venueId)
    .order('date', { ascending: false });

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-line bg-elev sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl font-bricolage font-bold text-text">
                Evenementen
              </h1>
              <p className="text-sm text-dim mt-1">
                {venue.name}
              </p>
            </div>
            <Link
              href={`/admin/venues/${venueId}/events/new`}
              className="btn-primary"
            >
              + Nieuw evenement
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {events.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-dim mb-4">Geen evenementen aangemaakt.</p>
            <Link
              href={`/admin/venues/${venueId}/events/new`}
              className="btn-primary"
            >
              Eerste evenement aanmaken
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {events.map((event) => (
              <Link
                key={event.id}
                href={`/admin/venues/${venueId}/events/${event.id}`}
                className="card hover:border-accent/50 transition-colors group cursor-pointer"
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <h2 className="font-medium text-text group-hover:text-accent transition-colors">
                      {event.name}
                    </h2>
                    <p className="text-sm text-dim mt-1">
                      {formatDate(event.date)}
                    </p>
                  </div>
                  <span className={`text-xs font-medium px-2 py-1 rounded-full whitespace-nowrap ml-2 ${
                    event.status === 'draft' ? 'bg-dim/20 text-dim' :
                    event.status === 'open' ? 'bg-accent/20 text-accent' :
                    event.status === 'live' ? 'bg-accent/20 text-accent' :
                    'bg-faint/20 text-faint'
                  }`}>
                    {event.status === 'draft' && 'Concept'}
                    {event.status === 'open' && 'Open'}
                    {event.status === 'live' && 'Live'}
                    {event.status === 'closed' && 'Gesloten'}
                  </span>
                </div>

                {event.list_locked && (
                  <div className="mb-3 px-2 py-1 bg-accent/10 border border-accent/20 rounded text-xs text-accent inline-block">
                    🔒 Gastenlijst vergrendeld
                  </div>
                )}

                <div className="space-y-2 text-sm text-dim">
                  {event.landing_slug && (
                    <div>
                      Landing: {event.landing_active ? '✓ Actief' : '○ Inactief'}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
