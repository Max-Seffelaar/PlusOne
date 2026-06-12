import { redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser } from '@/lib/auth';

export const metadata = {
  title: 'Venues — PLUSONE',
};

export default async function VenuesPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  const supabase = await getServerSupabaseClient();

  // Get first venue user has access to
  const { data: memberships, error } = await supabase
    .from('venue_memberships')
    .select('venue_id')
    .eq('user_id', user.id)
    .limit(1);

  console.log('Memberships query:', { user_id: user.id, memberships, error });

  if (memberships && memberships.length > 0) {
    redirect(`/admin/venues/${memberships[0].venue_id}`);
  }

  // No venues found
  return (
    <main className="min-h-screen flex items-center justify-center bg-bg">
      <div className="text-center">
        <h1 className="text-2xl font-bricolage font-bold mb-4">No Venues</h1>
        <p className="text-dim">You don't have access to any venues yet.</p>
      </div>
    </main>
  );
}
