import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Client-agnostic po reads (mirrors src/features/stats/data.ts): every function
// takes the caller's Supabase client, so a Server Component can prefetch with the
// request-scoped server client and a Client Component can read with the browser
// client. This module NEVER creates a client, so the server client can't leak
// into the client bundle. RLS is the boundary — an out-of-scope id yields [].
type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];

export type PoEventRow = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  status: Database['public']['Enums']['event_status'];
  list_locked: boolean;
  venue_name: string;
};

export type PoGuestRow = Pick<
  Tables['guests']['Row'],
  'id' | 'full_name' | 'plus_ones' | 'status' | 'tier_id' | 'note' | 'note_priority' | 'created_at'
>;

export type PoTierRow = Pick<
  Tables['guest_tiers']['Row'],
  'id' | 'name' | 'color' | 'max_guests' | 'aliases'
>;

/** All events for a venue, newest first (RLS: members read their venue's events). */
export async function fetchEvents(client: Client, venueId: string): Promise<PoEventRow[]> {
  const { data } = await client
    .from('events')
    .select('id, name, starts_at, ends_at, status, list_locked, venues(name)')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false });

  return (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    status: e.status,
    list_locked: e.list_locked,
    venue_name: e.venues?.name ?? '',
  }));
}

/** Active guests for an event (soft-deleted excluded), oldest first. */
export async function fetchGuests(client: Client, eventId: string): Promise<PoGuestRow[]> {
  const { data } = await client
    .from('guests')
    .select('id, full_name, plus_ones, status, tier_id, note, note_priority, created_at')
    .eq('event_id', eventId)
    .neq('status', 'removed')
    .order('created_at', { ascending: true });

  return data ?? [];
}

/** Tiers for an event (RLS: members read their venue's tiers). */
export async function fetchTiers(client: Client, eventId: string): Promise<PoTierRow[]> {
  const { data } = await client
    .from('guest_tiers')
    .select('id, name, color, max_guests, aliases')
    .eq('event_id', eventId)
    .order('name', { ascending: true });

  return data ?? [];
}

// ── Settings cluster reads (S6 team/quota, S7 profile/sessions, S8 venue, billing) ──
// Same client-agnostic shape: a Server Component can prefetch, a Client Component
// reads with the browser client. RLS scopes every row — a staff member who can't
// read the team list simply gets [], which the screen renders as an empty state.

export type PoMemberRow = {
  user_id: string;
  full_name: string;
  email: string;
  roles: Database['public']['Enums']['venue_role'][];
  job_title: string | null;
};

/** Members of a venue (RLS: admin/user_manager/finance may read these). */
export async function fetchVenueMembers(client: Client, venueId: string): Promise<PoMemberRow[]> {
  const { data } = await client
    .from('venue_memberships')
    .select('user_id, roles, job_title, user_profiles(full_name, email)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    full_name: row.user_profiles?.full_name ?? '—',
    email: row.user_profiles?.email ?? '—',
    roles: row.roles,
    job_title: row.job_title ?? null,
  }));
}

export type PoInviteRow = Pick<
  Tables['invites']['Row'],
  'id' | 'email' | 'roles' | 'expires_at' | 'created_at'
>;

/** Open (un-accepted) invites for a venue (RLS: managers + finance). */
export async function fetchPendingInvites(client: Client, venueId: string): Promise<PoInviteRow[]> {
  const { data } = await client
    .from('invites')
    .select('id, email, roles, expires_at, created_at')
    .eq('venue_id', venueId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export type PoQuotaRow = Pick<Tables['quotas']['Row'], 'user_id' | 'default_count'>;

/** Per-member default quotas at a venue (RLS quotas_select: own row, or all for
 *  admin/finance). The caller maps these onto the member list; a missing row
 *  means the member falls back to the venue default. */
export async function fetchMemberQuotas(client: Client, venueId: string): Promise<PoQuotaRow[]> {
  const { data } = await client
    .from('quotas')
    .select('user_id, default_count')
    .eq('venue_id', venueId);

  return data ?? [];
}

export type PoSessionRow = {
  session_id: string;
  created_at: string;
  updated_at: string;
  not_after: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
  is_current: boolean;
};

/** The caller's own active sessions (SECURITY DEFINER RPC reads auth.sessions for
 *  auth.uid() — callable from the browser client, scoped to the caller). */
export async function fetchOwnSessions(client: Client): Promise<PoSessionRow[]> {
  const { data } = await client.rpc('list_own_sessions');
  return (data ?? []).map((s) => ({
    session_id: s.session_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
    not_after: s.not_after,
    user_agent: s.user_agent,
    ip: s.ip,
    aal: s.aal,
    is_current: s.is_current ?? false,
  }));
}

export type PoProfileRow = Pick<
  Tables['user_profiles']['Row'],
  'id' | 'full_name' | 'first_name' | 'last_name' | 'email' | 'phone'
>;

/** The caller's own profile (RLS: a user always reads their own row, #24). */
export async function fetchMyProfile(client: Client, userId: string): Promise<PoProfileRow | null> {
  const { data } = await client
    .from('user_profiles')
    .select('id, full_name, first_name, last_name, email, phone')
    .eq('id', userId)
    .maybeSingle();

  return data ?? null;
}

export type PoVenueSettingsRow = Pick<
  Tables['venues']['Row'],
  | 'id'
  | 'name'
  | 'slug'
  | 'retention_months'
  | 'default_personal_quota'
  | 'company_name'
  | 'kvk_number'
  | 'vat_number'
  | 'finance_email'
  | 'address_line'
  | 'postal_code'
  | 'city'
  | 'country'
>;

/** Venue settings (RLS venues_select: any member reads; only admin may update). */
export async function fetchVenueSettings(
  client: Client,
  venueId: string
): Promise<PoVenueSettingsRow | null> {
  const { data } = await client
    .from('venues')
    .select(
      'id, name, slug, retention_months, default_personal_quota, company_name, kvk_number, vat_number, finance_email, address_line, postal_code, city, country'
    )
    .eq('id', venueId)
    .maybeSingle();

  return data ?? null;
}

export type PoSubscriptionRow = Pick<
  Tables['subscriptions']['Row'],
  'status' | 'plan_id' | 'current_period_end'
>;

/** The venue's subscription entitlement (RLS subscriptions_select_member: any
 *  member reads). Read-only — writes flow through Stripe webhooks only (#32). */
export async function fetchSubscription(
  client: Client,
  venueId: string
): Promise<PoSubscriptionRow | null> {
  const { data } = await client
    .from('subscriptions')
    .select('status, plan_id, current_period_end')
    .eq('venue_id', venueId)
    .maybeSingle();

  return data ?? null;
}
