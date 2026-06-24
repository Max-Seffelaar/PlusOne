import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from './context';
import type { VenueRole } from '@/features/auth/roles';

export interface Membership {
  venueId: string;
  venueName: string;
  roles: VenueRole[];
}

export interface VenueMember {
  userId: string;
  fullName: string;
  email: string;
  roles: VenueRole[];
  /** Per-venue job title (functie), null when not set. */
  jobTitle: string | null;
}

export interface PendingInvite {
  id: string;
  venueId: string;
  venueName?: string;
  email: string;
  roles: VenueRole[];
  expiresAt: string;
  createdAt: string;
}

// The caller's own memberships (RLS: a user always sees their own). Drives the
// venue switcher and "which venues do I manage" decisions.
export async function getMyMemberships(): Promise<Membership[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('venue_id, roles, venues(name)')
    .eq('user_id', user.id);

  return (data ?? []).map((row) => ({
    venueId: row.venue_id,
    venueName: row.venues?.name ?? 'Unknown venue',
    roles: row.roles,
  }));
}

// Venues where the caller may see reports & the audit log: admin or finance
// (spec §2 — "Statistieken & rapportages", "Audit log inzien"). Drives the
// admin analytics screens and their venue switcher; Finance is read-only.
export async function getReportingVenues(): Promise<Membership[]> {
  const mine = await getMyMemberships();
  return mine.filter((m) => m.roles.includes('admin') || m.roles.includes('finance'));
}

// Members of a venue (RLS: admin/user_manager/finance may read these).
export async function getVenueMembers(venueId: string): Promise<VenueMember[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('user_id, roles, job_title, user_profiles(full_name, email)')
    .eq('venue_id', venueId);

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    fullName: row.user_profiles?.full_name ?? '—',
    email: row.user_profiles?.email ?? '—',
    roles: row.roles,
    jobTitle: row.job_title ?? null,
  }));
}

// Open (un-accepted) invites for a venue (RLS: managers + finance).
export async function getPendingInvitesForVenue(venueId: string): Promise<PendingInvite[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('invites')
    .select('id, venue_id, email, roles, expires_at, created_at')
    .eq('venue_id', venueId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    venueId: row.venue_id,
    email: row.email,
    roles: row.roles,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

// Invites addressed to the current user that are still open (RLS: invitee sees
// their own by e-mail). Filtered to the caller's OWN e-mail so a manager does
// not see venue-wide invites here. Drives the "accepteer uitnodiging"-banner
// for users who were already signed in when invited to another venue.
export async function getMyPendingInvites(): Promise<PendingInvite[]> {
  const user = await getSessionUser();
  if (!user?.email) return [];
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const { data } = await supabase
    .from('invites')
    .select('id, venue_id, email, roles, expires_at, created_at, venues(name)')
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .ilike('email', user.email)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    venueId: row.venue_id,
    venueName: row.venues?.name ?? undefined,
    email: row.email,
    roles: row.roles,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}
