import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { describeAuditEntry, type AuditLine } from './translate';

// Server-side audit-feed reads. Everything goes through the USER-scoped client,
// so the audit_feed view's RLS (admin/finance + AAL2, inherited from audit_log)
// decides what is visible — staff and other venues get nothing (#15/#17).
// Filtering and the row cap run in the database, never client-side over the
// whole log.

export interface AuditFilters {
  venueId: string;
  eventId?: string;
  /** "filter op user" — who performed the action (actor). */
  actorId?: string;
  /** "filter op gast" — the guest the entry concerns. */
  guestId?: string;
  /** "filter op actiesoort". */
  action?: string;
  /** Free-text on actor/guest/subject names (server-side ilike). */
  search?: string;
  limit?: number;
}

export interface AuditFilterOptions {
  events: { id: string; name: string }[];
  actors: { id: string; name: string }[];
}

// PostgREST `.or()` is comma/paren-delimited; strip those from user input so a
// search term can never break out of the filter expression.
function sanitizeSearch(term: string): string {
  return term.replace(/[,()*]/g, ' ').trim();
}

export async function fetchAuditFeed(filters: AuditFilters): Promise<AuditLine[]> {
  const supabase = await createClient();

  let query = supabase
    .from('audit_feed')
    .select('*')
    .eq('venue_id', filters.venueId)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.eventId) query = query.eq('event_id', filters.eventId);
  if (filters.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters.guestId) query = query.eq('guest_id', filters.guestId);
  if (filters.action && filters.action !== 'all') query = query.eq('action', filters.action);

  if (filters.search) {
    const s = sanitizeSearch(filters.search);
    if (s) {
      query = query.or(
        `actor_name.ilike.%${s}%,guest_name.ilike.%${s}%,subject_name.ilike.%${s}%`
      );
    }
  }

  const { data } = await query;
  return (data ?? []).map(describeAuditEntry);
}

export interface GuestHistory {
  guest: {
    id: string;
    fullName: string;
    tierName: string | null;
    status: string;
    plusOnes: number;
    eventName: string | null;
  } | null;
  lines: AuditLine[];
}

// The per-guest "geschiedenis" — every log line that concerns this guest
// (guest row changes + its check-ins/refusals), oldest first as a story (#15).
export async function fetchGuestHistory(guestId: string): Promise<GuestHistory> {
  const supabase = await createClient();

  const [{ data: rows }, { data: guest }] = await Promise.all([
    supabase
      .from('audit_feed')
      .select('*')
      .eq('guest_id', guestId)
      .order('created_at', { ascending: true }),
    supabase
      .from('guests')
      .select('id, full_name, plus_ones, status, guest_tiers(name), events(name)')
      .eq('id', guestId)
      .maybeSingle(),
  ]);

  return {
    guest: guest
      ? {
          id: guest.id,
          fullName: guest.full_name,
          tierName: guest.guest_tiers?.name ?? null,
          status: guest.status,
          plusOnes: guest.plus_ones,
          eventName: guest.events?.name ?? null,
        }
      : null,
    lines: (rows ?? []).map(describeAuditEntry),
  };
}

// Dropdown options for the filter bar. Events come from the venue; actors are
// the venue's members (the people who act in it) — a small, bounded set, far
// cheaper than DISTINCT over the whole log.
export async function fetchAuditFilterOptions(venueId: string): Promise<AuditFilterOptions> {
  const supabase = await createClient();

  const [{ data: events }, { data: members }] = await Promise.all([
    supabase
      .from('events')
      .select('id, name, starts_at')
      .eq('venue_id', venueId)
      .order('starts_at', { ascending: false }),
    supabase
      .from('venue_memberships')
      .select('user_id, user_profiles(full_name)')
      .eq('venue_id', venueId),
  ]);

  return {
    events: (events ?? []).map((e) => ({ id: e.id, name: e.name })),
    actors: (members ?? [])
      .map((m) => ({ id: m.user_id, name: m.user_profiles?.full_name ?? 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  };
}
