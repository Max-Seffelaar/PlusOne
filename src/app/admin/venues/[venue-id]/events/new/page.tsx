import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import Link from 'next/link';
import { CreateEventForm } from '../components/create-event-form';

interface PageProps {
  params: Promise<{ 'venue-id': string }>;
}

export const metadata = {
  title: 'Nieuw evenement — PLUSONE',
};

export default async function NewEventPage({ params }: PageProps) {
  const { 'venue-id': venueId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const { allowed } = await checkVenueMembership(venueId, ['admin']);
  if (!allowed) {
    redirect('/');
  }

  const supabase = await getServerSupabaseClient();
  const { data: venue } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-line bg-elev sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2">
            <Link
              href={`/admin/venues/${venueId}/events`}
              className="text-dim hover:text-text transition-colors"
            >
              ← Terug
            </Link>
          </div>
          <h1 className="text-2xl font-bricolage font-bold text-text mt-2">
            Nieuw evenement
          </h1>
          <p className="text-sm text-dim mt-1">
            {venue?.name}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <CreateEventForm venueId={venueId} />
      </div>
    </main>
  );
}
