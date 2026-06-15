import 'server-only';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';

// Statistics reads (#26, spec §6). Every number is aggregated in Postgres by the
// analytics functions (20260614120000_admin_analytics.sql); the app only shapes
// and renders. The functions self-guard on role (admin/finance, or organizer for
// event-level), so staff get nothing here — they only have their own quota
// counter via event_quota_status (#17).

type Fn = Database['public']['Functions'];

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

export async function fetchEventStats(eventId: string): Promise<EventStats> {
  const supabase = await createClient();

  const [summary, perQuarter, tiers, users, refusals] = await Promise.all([
    supabase.rpc('event_stats_summary', { p_event_id: eventId }).maybeSingle(),
    supabase.rpc('event_checkins_per_quarter', { p_event_id: eventId }),
    supabase.rpc('event_tier_stats', { p_event_id: eventId }),
    supabase.rpc('event_user_additions', { p_event_id: eventId }),
    supabase.rpc('event_refusal_reasons', { p_event_id: eventId }),
  ]);

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
  venueId: string,
  from: string | null,
  to: string | null
): Promise<VenueStats> {
  const supabase = await createClient();
  // The functions default p_from/p_to to NULL (unbounded); the generated arg
  // type is optional, so pass undefined (omitted on the wire) rather than null.
  const args = { p_venue_id: venueId, p_from: from ?? undefined, p_to: to ?? undefined };

  const [summary, rollup, users, refusals] = await Promise.all([
    supabase.rpc('venue_stats_summary', args).maybeSingle(),
    supabase.rpc('venue_event_rollup', args),
    supabase.rpc('venue_user_additions', args),
    supabase.rpc('venue_refusal_reasons', args),
  ]);

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
export async function fetchVenueEvents(venueId: string): Promise<PickerEvent[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('events')
    .select('id, name, starts_at, status')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false });

  return (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    startsAt: e.starts_at,
    status: e.status,
  }));
}
