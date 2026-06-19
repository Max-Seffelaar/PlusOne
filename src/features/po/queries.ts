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
