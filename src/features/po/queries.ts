import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { EventSummary, TierStat } from '@/features/stats/data';

// Client-agnostic po reads (mirrors src/features/stats/data.ts): every function
// takes the caller's Supabase client, so a Server Component can prefetch with the
// request-scoped server client and a Client Component can read with the browser
// client. This module NEVER creates a client, so the server client can't leak
// into the client bundle. RLS is the boundary — an out-of-scope id yields [].
type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];
type GuestRowStatus = Database['public']['Enums']['guest_status'];

// "On the list" headcount = guests that occupy a slot (approved or already in);
// pending (awaiting approval) and denied/removed/refused don't count. Mirrors the
// confirmed-list notion the Events cards show. (#5 quota math: 1 + plus_ones.)
const ON_LIST: GuestRowStatus[] = ['approved', 'checked_in'];

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

/**
 * Active guests for an event (soft-deleted excluded), oldest first.
 *
 * This is the po surface's canonical guest read, lifted out of the desktop
 * `(app)/events/[eventId]/guests/page.tsx` inline select so both the desktop
 * Server Component and the mobile Client Components share one query shape
 * (STAP 3.4). Both run through the USER-scoped client, so RLS stays the
 * boundary — staff see only their own guests, an out-of-scope id yields [].
 * The desktop page keeps its own richer select (email/phone/source for the
 * edit form, removed rows shown struck-through); this lean projection is
 * exactly what `toPoGuest` needs.
 */
export async function fetchPoGuests(client: Client, eventId: string): Promise<PoGuestRow[]> {
  const { data } = await client
    .from('guests')
    .select('id, full_name, plus_ones, status, tier_id, note, note_priority, created_at')
    .eq('event_id', eventId)
    .neq('status', 'removed')
    .order('created_at', { ascending: true });

  return data ?? [];
}

export interface PoQuotaStatus {
  /** Personal slot allowance for this event; -1 when exempt (admin/organizer). */
  quota: number;
  /** Slots already consumed by the caller (1 + plus-ones each). */
  consumed: number;
  /** Slots left, or null when exempt. */
  remaining: number | null;
  /** Admin/organizer: no personal limit. */
  exempt: boolean;
}

/**
 * The caller's personal quota for an event (#22/#31), via the same
 * `event_quota_status` RPC the desktop guests page uses. Drives the quick-add
 * "X van N over" hint and the pre-submit overage block. The DB is still the
 * real enforcement boundary — this is early UI feedback only.
 */
export async function fetchEventQuota(
  client: Client,
  eventId: string
): Promise<PoQuotaStatus | null> {
  const { data } = await client
    .rpc('event_quota_status', { p_event_id: eventId })
    .maybeSingle();
  if (!data) return null;
  return {
    quota: data.quota,
    consumed: data.consumed,
    remaining: data.exempt ? null : data.remaining,
    exempt: data.exempt,
  };
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

export interface EventHeadcount {
  /** On-list headcount (1 + plus-ones over approved/checked-in guests). */
  registered: number;
  /** Present headcount (1 + plus-ones over checked-in guests). */
  present: number;
}

/**
 * Registered + present headcounts for many events in ONE query — the Events /
 * EventBeheer cards show these without an RPC per row. Aggregated client-side
 * from the guests rows RLS already lets the caller read.
 */
export async function fetchEventHeadcounts(
  client: Client,
  eventIds: string[]
): Promise<Map<string, EventHeadcount>> {
  const counts = new Map<string, EventHeadcount>();
  if (eventIds.length === 0) return counts;

  const { data } = await client
    .from('guests')
    .select('event_id, plus_ones, status')
    .in('event_id', eventIds)
    .in('status', ON_LIST);

  for (const g of data ?? []) {
    const cur = counts.get(g.event_id) ?? { registered: 0, present: 0 };
    const heads = 1 + g.plus_ones;
    cur.registered += heads;
    if (g.status === 'checked_in') cur.present += heads;
    counts.set(g.event_id, cur);
  }
  return counts;
}

export interface RecentCheckinRow {
  guestId: string;
  name: string;
  /** Plus-ones that actually arrived on this check-in. */
  plus: number;
  /** Check-in instant (ISO) for display. */
  at: string;
}

/** Most recent (non-voided) check-ins for an event — drives "Laatst binnen". */
export async function fetchRecentCheckins(
  client: Client,
  eventId: string,
  limit = 3
): Promise<RecentCheckinRow[]> {
  const { data } = await client
    .from('check_ins')
    .select('checked_at, plus_ones_arrived, guests!inner(id, full_name, event_id)')
    .eq('guests.event_id', eventId)
    .is('voided_at', null)
    .order('checked_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) => ({
    guestId: r.guests.id,
    name: r.guests.full_name,
    plus: r.plus_ones_arrived,
    at: r.checked_at,
  }));
}

/** Count of open (pending) guest requests for an event — the "Aandacht nodig" nudge. */
export async function fetchOpenRequestCount(client: Client, eventId: string): Promise<number> {
  const { count } = await client
    .from('guest_requests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'pending');

  return count ?? 0;
}

export interface RecapGuestRow {
  id: string;
  full_name: string;
  plus_ones: number;
  status: GuestRowStatus;
  tierName: string | null;
  addedByName: string | null;
  /** Latest non-voided check-in instant (ISO), or null when never arrived. */
  checkedAt: string | null;
}

/**
 * Guests of a (past) event with their tier, who-added, and check-in time — the
 * source for the recap's "ingecheckt" and "niet verschenen" lists. Only on-list
 * statuses; the per-guest check-in time is the latest non-voided check_in.
 */
export async function fetchRecapGuests(client: Client, eventId: string): Promise<RecapGuestRow[]> {
  const { data } = await client
    .from('guests')
    .select(
      'id, full_name, plus_ones, status, guest_tiers(name), added_by_profile:user_profiles!guests_added_by_fkey(full_name), check_ins(checked_at, voided_at)'
    )
    .eq('event_id', eventId)
    .in('status', ON_LIST);

  return (data ?? []).map((g) => {
    // The generated client can type the embed as to-one OR to-many; normalize to
    // an array (and drop any nullish) before reading the latest non-voided time.
    const checkins = [g.check_ins].flat().filter(Boolean) as Array<{
      checked_at: string;
      voided_at: string | null;
    }>;
    const checkedAt = checkins
      .filter((c) => c.voided_at == null)
      .map((c) => c.checked_at)
      .sort()
      .at(-1);
    return {
      id: g.id,
      full_name: g.full_name,
      plus_ones: g.plus_ones,
      status: g.status,
      tierName: g.guest_tiers?.name ?? null,
      addedByName: g.added_by_profile?.full_name ?? null,
      checkedAt: checkedAt ?? null,
    };
  });
}

export interface PastEventStats {
  summary: EventSummary | null;
  tiers: TierStat[];
}

/** The two analytics RPCs the past-event recap needs (refused + peak + per-tier). */
export async function fetchPastEventStats(
  client: Client,
  eventId: string
): Promise<PastEventStats> {
  const [summary, tiers] = await Promise.all([
    client.rpc('event_stats_summary', { p_event_id: eventId }).maybeSingle(),
    client.rpc('event_tier_stats', { p_event_id: eventId }),
  ]);
  return { summary: summary.data ?? null, tiers: tiers.data ?? [] };
}

export interface EventEditRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  status: Database['public']['Enums']['event_status'];
  landingActive: boolean;
  landingSlug: string;
  listLocked: boolean;
  autoLockAt: string | null;
  venueName: string;
  /** The caller is an organizer scoped to this event (admin is derived from roles). */
  isOrganizer: boolean;
}

/** A single event with the editable fields + the caller's organizer scope (EventEdit). */
export async function fetchEventForEdit(
  client: Client,
  eventId: string,
  userId: string
): Promise<EventEditRow | null> {
  const [{ data: e }, { data: org }] = await Promise.all([
    client
      .from('events')
      .select(
        'id, name, starts_at, ends_at, status, landing_active, landing_slug, list_locked, auto_lock_at, venues(name)'
      )
      .eq('id', eventId)
      .maybeSingle(),
    client
      .from('event_organizers')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (!e) return null;

  return {
    id: e.id,
    name: e.name,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    landingActive: e.landing_active,
    landingSlug: e.landing_slug,
    listLocked: e.list_locked,
    autoLockAt: e.auto_lock_at,
    venueName: e.venues?.name ?? '',
    isOrganizer: !!org,
  };
}

export type TierWithUsage = PoTierRow & { used: number };

/**
 * Tiers of an event with current occupancy — mirrors getEventTiers: "used" counts
 * entries that aren't removed/denied (matches guest_tier_contribution), as people
 * (not headcount), for the tier-max bar.
 */
export async function fetchTiersWithUsage(
  client: Client,
  eventId: string
): Promise<TierWithUsage[]> {
  const [{ data: tiers }, { data: guests }] = await Promise.all([
    client.from('guest_tiers').select('id, name, color, max_guests, aliases').eq('event_id', eventId).order('name'),
    client.from('guests').select('tier_id, status').eq('event_id', eventId),
  ]);

  const used = new Map<string, number>();
  for (const g of guests ?? []) {
    if (g.status === 'removed' || g.status === 'denied') continue;
    used.set(g.tier_id, (used.get(g.tier_id) ?? 0) + 1);
  }

  return (tiers ?? []).map((t) => ({ ...t, used: used.get(t.id) ?? 0 }));
}

// ── Address book reads (S3 Adresboek + Import) ──
// Direct contacts-table reads, so RLS (20260615130000) limits them to admin /
// finance / event-organizer — staff/doorhost get [] and the screen renders empty.
// Client-agnostic like the rest of this module.

export type PoContactRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  preferred_role: Database['public']['Enums']['contact_role'] | null;
  note: string | null;
  is_permanent: boolean;
  /** Distinct non-removed events this contact has appeared on ("X× op een lijst"). */
  eventCount: number;
};

/** Distinct-events-per-contact map, scoped by RLS to what the caller can read. */
async function contactEventCounts(client: Client, contactIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contactIds.length === 0) return counts;
  const { data } = await client
    .from('guests')
    .select('contact_id, event_id')
    .in('contact_id', contactIds)
    .neq('status', 'removed');

  const seen = new Map<string, Set<string>>();
  for (const g of data ?? []) {
    if (!g.contact_id) continue;
    const set = seen.get(g.contact_id) ?? new Set<string>();
    set.add(g.event_id);
    seen.set(g.contact_id, set);
  }
  for (const [cid, set] of seen) counts.set(cid, set.size);
  return counts;
}

/** The venue address book (managers), newest-name-first, with per-contact event counts. */
export async function fetchContacts(
  client: Client,
  venueId: string,
  search?: string
): Promise<PoContactRow[]> {
  let query = client
    .from('contacts')
    .select('id, full_name, email, phone, birthdate, preferred_role, note, is_permanent')
    .eq('venue_id', venueId)
    .is('anonymized_at', null)
    .order('full_name');
  const term = search?.trim();
  if (term) query = query.ilike('full_name', `%${term}%`);

  const { data } = await query;
  const rows = data ?? [];
  const counts = await contactEventCounts(client, rows.map((c) => c.id));
  return rows.map((c) => ({ ...c, eventCount: counts.get(c.id) ?? 0 }));
}

/** Minimal e-mail/phone projection for the import dedup preview ("BESTAAT AL"). */
export async function fetchContactKeyRows(
  client: Client,
  venueId: string
): Promise<{ email: string | null; phone: string | null }[]> {
  const { data } = await client
    .from('contacts')
    .select('email, phone')
    .eq('venue_id', venueId)
    .is('anonymized_at', null);
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
