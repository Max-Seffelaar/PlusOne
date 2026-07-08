import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

// Statistics reads (#26, spec §6), shared by server pages (prefetch with the
// request-scoped server client) and client screens (browser client). Every number
// is aggregated in Postgres by the analytics functions
// (20260614120000_admin_analytics.sql); callers only shape and render. The
// functions are SECURITY DEFINER and self-guard on role (admin/finance, or
// organizer for event-level), so an out-of-scope id yields an EMPTY result, never
// an error. The caller supplies the user-scoped client; this module never creates
// one, so the server client can't leak into a client bundle.

type Fn = Database['public']['Functions'];
type Client = SupabaseClient<Database>;

export type EventSummary = Fn['event_stats_summary']['Returns'][number];
export type QuarterBucket = Fn['event_checkins_per_quarter']['Returns'][number];
export type TierStat = Fn['event_tier_stats']['Returns'][number];
export type UserAddition = Fn['event_user_additions']['Returns'][number];
export type RefusalReason = Fn['event_refusal_reasons']['Returns'][number];

export interface EventStats {
  summary: EventSummary | null;
  perQuarter: QuarterBucket[];
  tiers: TierStat[];
  users: UserAddition[];
  refusals: RefusalReason[];
}

export async function fetchEventStats(client: Client, eventId: string): Promise<EventStats> {
  const [summary, perQuarter, tiers, users, refusals] = await Promise.all([
    client.rpc('event_stats_summary', { p_event_id: eventId }).maybeSingle(),
    client.rpc('event_checkins_per_quarter', { p_event_id: eventId }),
    client.rpc('event_tier_stats', { p_event_id: eventId }),
    client.rpc('event_user_additions', { p_event_id: eventId }),
    client.rpc('event_refusal_reasons', { p_event_id: eventId }),
  ]);

  // A real fetch failure (network/transient DB/RPC exception) must never be
  // coerced into an empty result — that's indistinguishable from the
  // legitimate role-gated empty result the SECURITY DEFINER functions return
  // for an out-of-scope id (see file header). Throw generic (C25); the caller
  // renders an error state instead of silent zeros.
  if (summary.error || perQuarter.error || tiers.error || users.error || refusals.error) {
    throw new Error('Failed to load statistics.');
  }

  return {
    summary: summary.data ?? null,
    perQuarter: perQuarter.data ?? [],
    tiers: tiers.data ?? [],
    users: users.data ?? [],
    refusals: refusals.data ?? [],
  };
}

export type VenueSummary = Fn['venue_stats_summary']['Returns'][number];
export type EventRollup = Fn['venue_event_rollup']['Returns'][number];
export type VenueUserAddition = Fn['venue_user_additions']['Returns'][number];

export interface VenueStats {
  summary: VenueSummary | null;
  rollup: EventRollup[];
  users: VenueUserAddition[];
  refusals: RefusalReason[];
}

export async function fetchVenueStats(
  client: Client,
  venueId: string,
  from: string | null,
  to: string | null
): Promise<VenueStats> {
  // The functions default p_from/p_to to NULL (unbounded); the generated arg
  // type is optional, so pass undefined (omitted on the wire) rather than null.
  const args = { p_venue_id: venueId, p_from: from ?? undefined, p_to: to ?? undefined };

  const [summary, rollup, users, refusals] = await Promise.all([
    client.rpc('venue_stats_summary', args).maybeSingle(),
    client.rpc('venue_event_rollup', args),
    client.rpc('venue_user_additions', args),
    client.rpc('venue_refusal_reasons', args),
  ]);

  // See fetchEventStats above: a real error must throw, never fall back to an
  // empty shape (C25) — that would be indistinguishable from the legitimate
  // role-gated empty result.
  if (summary.error || rollup.error || users.error || refusals.error) {
    throw new Error('Failed to load statistics.');
  }

  return {
    summary: summary.data ?? null,
    rollup: rollup.data ?? [],
    users: users.data ?? [],
    refusals: refusals.data ?? [],
  };
}

export interface PickerEvent {
  id: string;
  name: string;
  startsAt: string;
  status: Database['public']['Enums']['event_status'];
}

// Events for the stats event-picker (RLS: members read their venue's events).
export async function fetchVenueEvents(client: Client, venueId: string): Promise<PickerEvent[]> {
  const { data, error } = await client
    .from('events')
    .select('id, name, starts_at, status')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false });

  // See fetchEventStats above: a real fetch error must throw, not render as
  // "no events yet" (C25).
  if (error) throw new Error('Failed to load statistics.');

  return (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    startsAt: e.starts_at,
    status: e.status,
  }));
}
