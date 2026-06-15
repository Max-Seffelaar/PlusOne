/**
 * Live fetchers for the prototype screens. Each takes the caller's USER-scoped
 * Supabase client, so RLS decides visibility (CLAUDE.md: prefer the user-scoped
 * client, never the service client). They return the prototype view types so the
 * screens consume them unchanged.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { PoEvent, Venue } from '@/lib/po/types';
import { aggregateGuestCounts, toPoEvent } from './live-map';

type Client = SupabaseClient<Database>;
type VenueRole = Database['public']['Enums']['venue_role'];

export interface PoProfile {
  id: string;
  name: string;
  email: string;
}

export interface PoSession {
  userId: string;
  profile: PoProfile;
  venues: Venue[];
  /** The venue the app currently scopes to (first membership by default). */
  currentVenueId: string | null;
}

// `organizer` is an event-level scope (event_organizers), not a venue role —
// it is deliberately absent from venue_role.
const ROLE_LABEL: Record<VenueRole, string> = {
  admin: 'Admin',
  user_manager: 'Gebruikersbeheer',
  finance: 'Finance',
  staff: 'Staff',
  doorhost: 'Doorhost',
};

const PLAN_LABEL: Record<string, string> = {
  comped: 'Pilot',
  trialing: 'Proef',
  active: 'Actief',
  past_due: 'Betaling open',
  canceled: 'Gestopt',
};

/** User + profile + the venues they belong to, mapped for the venue switcher. */
export async function fetchPoSession(client: Client): Promise<PoSession | null> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  const [{ data: profileRow }, { data: memberships }] = await Promise.all([
    client.from('user_profiles').select('id, full_name, email').eq('id', user.id).maybeSingle(),
    client
      .from('venue_memberships')
      .select('roles, venue:venues(id, name)')
      .eq('user_id', user.id),
  ]);

  const venueIds = (memberships ?? [])
    .map((m) => (m.venue as { id: string } | null)?.id)
    .filter((id): id is string => Boolean(id));

  const { data: subs } = venueIds.length
    ? await client.from('subscriptions').select('venue_id, status').in('venue_id', venueIds)
    : { data: [] as { venue_id: string; status: string }[] };
  const planByVenue = new Map((subs ?? []).map((s) => [s.venue_id, s.status]));

  const venues: Venue[] = (memberships ?? [])
    .map((m, i): Venue | null => {
      const v = m.venue as { id: string; name: string } | null;
      if (!v) return null;
      const status = planByVenue.get(v.id) ?? '';
      return {
        id: v.id,
        name: v.name,
        city: '',
        plan: PLAN_LABEL[status] ?? '—',
        roles: (m.roles ?? []).map((r) => ROLE_LABEL[r] ?? r),
        events: 0,
        current: i === 0,
      };
    })
    .filter((v): v is Venue => v !== null);

  const profile: PoProfile = {
    id: user.id,
    name: profileRow?.full_name ?? (user.user_metadata?.full_name as string) ?? user.email ?? '',
    email: profileRow?.email ?? user.email ?? '',
  };

  return {
    userId: user.id,
    profile,
    venues,
    currentVenueId: venues[0]?.id ?? null,
  };
}

/** Events for a venue, with RLS-scoped guest/inside counts, as PoEvent[]. */
export async function fetchPoEvents(client: Client, venueId: string): Promise<PoEvent[]> {
  const [{ data: venue }, { data: events }] = await Promise.all([
    client.from('venues').select('id, name').eq('id', venueId).maybeSingle(),
    client
      .from('events')
      .select('id, name, starts_at, ends_at, status, venue_id, list_locked, created_at, landing_active, landing_slug, locked_at, locked_by, updated_at, went_live_at')
      .eq('venue_id', venueId)
      .order('starts_at', { ascending: true }),
  ]);

  const rows = events ?? [];
  const ids = rows.map((e) => e.id);
  const { data: guestRows } = ids.length
    ? await client.from('guests').select('event_id, status, plus_ones').in('event_id', ids)
    : { data: [] as { event_id: string; status: string; plus_ones: number }[] };

  const counts = aggregateGuestCounts(guestRows ?? []);
  const now = new Date();
  const venueName = venue?.name ?? '';
  return rows.map((e) => toPoEvent(e, venueName, counts.get(e.id), now));
}
