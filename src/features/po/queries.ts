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
