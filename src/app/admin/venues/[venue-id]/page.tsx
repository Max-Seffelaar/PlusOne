import { notFound, redirect } from 'next/navigation';
import { getServerSupabaseClient } from '@/lib/supabase/server-client';
import { getCurrentUser, checkVenueMembership } from '@/lib/auth';
import { Database } from '@/lib/database.types';
import {
  VenueSwitcher,
  VenueSettings,
  MemberList,
  QuotaManager
} from '@/features/venue-admin/components';

interface PageProps {
  params: Promise<{ 'venue-id': string }>;
}

export const metadata = {
  title: 'Locatie-instellingen — PLUSONE',
};

export default async function VenueAdminPage({ params }: PageProps) {
  const { 'venue-id': venueId } = await params;

  const user = await getCurrentUser();
  if (!user) {
    redirect('/login');
  }

  // Check membership and get required role data
  const { allowed, membership: userMembership } = await checkVenueMembership(venueId);
  if (!allowed || !userMembership) {
    notFound();
  }

  const memberRoles = userMembership.roles as any || [];
  const isAdmin = memberRoles.includes('admin') || memberRoles.includes('super_admin');
  const isUserManager = memberRoles.includes('user_manager') || memberRoles.includes('super_admin');
  const isFinance = memberRoles.includes('finance') || memberRoles.includes('super_admin');
  const canViewAdmin = isAdmin || isUserManager || isFinance;

  if (!canViewAdmin) {
    notFound();
  }

  const supabase = await getServerSupabaseClient();

  // Get venue data
  const { data: venueData, error: venueError } = await supabase
    .from('venues')
    .select('*')
    .eq('id', venueId)
    .single();

  if (venueError || !venueData) {
    notFound();
  }

  const venue = venueData as Database['public']['Tables']['venues']['Row'];

  // Get all memberships for this venue
  const { data: membershipsData } = await supabase
    .from('venue_memberships')
    .select('*, users(id, email, display_name)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  const memberships = membershipsData || [];

  // Get quotas
  const { data: quotasData } = await supabase
    .from('quotas')
    .select('*')
    .eq('venue_id', venueId);

  const quotas = quotasData || [];

  // Get user's memberships for switcher
  const { data: userMembershipsData } = await supabase
    .from('venue_memberships')
    .select('*, venues(id, name)')
    .eq('user_id', user.id)
    .order('created_at', { ascending: true });

  const userMemberships = userMembershipsData || [];

  return (
    <main className="min-h-screen bg-bg">
      {/* Header */}
      <div className="border-b border-border bg-bg-secondary sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center gap-4">
            <div>
              <h1 className="text-2xl font-bricolage font-bold text-text">
                {venue.name}
              </h1>
              <p className="text-sm text-dim mt-1">Locatie-instellingen en teammanagement</p>
            </div>
            {userMemberships.length > 1 && (
              <VenueSwitcher
                memberships={userMemberships}
                currentVenueId={venueId}
              />
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-20 space-y-4">
              <VenueSettings venue={venue} isAdmin={isAdmin} />

              {isAdmin && (
                <div className="p-4 rounded-lg bg-accent/10 border border-accent/20">
                  <p className="text-xs font-medium text-accent mb-2">Je rol:</p>
                  <p className="text-sm font-medium text-text">
                    {memberRoles.includes('super_admin') ? 'Super Admin' : 'Admin'}
                  </p>
                  <p className="text-xs text-dim mt-1">
                    {memberRoles.includes('super_admin')
                      ? 'Je hebt volledige controle over álle locaties.'
                      : 'Je hebt volledige controle over deze locatie.'}
                  </p>
                </div>
              )}

              {isUserManager && !isAdmin && (
                <div className="p-4 rounded-lg bg-accent/10 border border-accent/20">
                  <p className="text-xs font-medium text-accent mb-2">Je rol:</p>
                  <p className="text-sm font-medium text-text">Gebruikersbeheerder</p>
                  <p className="text-xs text-dim mt-1">
                    Je kan teamleden uitnodigen en rollen beheren.
                  </p>
                </div>
              )}

              {isFinance && !isAdmin && !isUserManager && (
                <div className="p-4 rounded-lg bg-accent/10 border border-accent/20">
                  <p className="text-xs font-medium text-accent mb-2">Je rol:</p>
                  <p className="text-sm font-medium text-text">Finance</p>
                  <p className="text-xs text-dim mt-1">
                    Read-only inzage in alle gastenlijsten en rapporten.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Main */}
          <div className="lg:col-span-2 space-y-8">
            <MemberList
              venueId={venueId}
              memberships={memberships}
              quotas={quotas}
              currentUserId={user.id}
              isAdmin={isAdmin}
              isUserManager={isUserManager}
              isFinance={isFinance}
            />

            {isAdmin && <QuotaManager
              venueId={venueId}
              memberships={memberships}
              quotas={quotas}
              isAdmin={isAdmin}
            />}
          </div>
        </div>
      </div>
    </main>
  );
}
