import { notFound, redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import { EventTabs } from '../components/event-tabs';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ 'venue-id': string; 'event-id': string }>;
}

export const metadata = {
  title: 'Evenement bewerken — PLUSONE',
};

export default async function EventDetailPage({ params }: PageProps) {
  const { 'venue-id': venueId, 'event-id': eventId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { allowed } = await checkVenueMembership(venueId, ['admin']);
  if (!allowed) {
    notFound();
  }

  const supabase = await getServerSupabaseClient();

  // Get venue
  const { data: venueData } = await (supabase
    .from('venues') as any)
    .select('*')
    .eq('id', venueId)
    .single();

  const venue = venueData as any;
  if (!venue) {
    notFound();
  }

  // Get event
  const { data: eventData } = await (supabase
    .from('events') as any)
    .select('*')
    .eq('id', eventId)
    .eq('venue_id', venueId)
    .single();

  const event = eventData as any;
  if (!event) {
    notFound();
  }

  // Get event tiers
  const { data: tiers = [] } = await (supabase
    .from('guest_tiers') as any)
    .select('*')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  // Get event organizers with user details
  const { data: organizers = [] } = await (supabase
    .from('event_organizers') as any)
    .select('*, users(id, email, display_name)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: true });

  // Get all users for organizer assignment (venue members)
  const { data: venueUsers = [] } = await (supabase
    .from('venue_memberships') as any)
    .select('*, users(id, email, display_name)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-line bg-elev sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/admin/venues/${venueId}/events`}
                  className="text-dim hover:text-text transition-colors"
                >
                  ← Terug
                </Link>
              </div>
              <h1 className="text-2xl font-bricolage font-bold text-text mt-2">
                {event.name}
              </h1>
              <p className="text-sm text-dim mt-1">
                {venue.name}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <EventTabs
          venueId={venueId}
          event={event}
          tiers={tiers}
          organizers={organizers}
          availableUsers={venueUsers}
          currentUserId={user.id}
        />
      </div>
    </main>
  );
}
