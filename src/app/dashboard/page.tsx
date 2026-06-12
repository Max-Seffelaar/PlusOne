import { getCurrentUser } from '@/lib/auth';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/auth/login');
  }

  const supabase = await getServerSupabaseClient();

  // Fetch user's venues
  const { data: memberships } = await supabase
    .from('venue_memberships')
    .select(`
      venue_id,
      roles,
      venues!inner(id, name, slug)
    `)
    .eq('user_id', user.id);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Mijn Venues</h2>

      {!memberships || memberships.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-gray-600">U bent nog geen lid van een venue. Wacht op een uitnodiging.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {memberships.map((membership: any) => (
            <div
              key={membership.venue_id}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition"
            >
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {membership.venues.name}
              </h3>
              <p className="text-sm text-gray-600 mb-4">
                Rollen: {membership.roles.join(', ')}
              </p>
              <a
                href={`/dashboard/${membership.venue_id}`}
                className="text-purple-600 hover:text-purple-700 font-medium"
              >
                Openen →
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
