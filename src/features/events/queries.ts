import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/context';
import type { EventStatus } from './status';
import type { VenueRole } from '@/features/auth/roles';

// Read paths for the event-management screens. Everything goes through the
// USER-scoped client, so RLS (fase 2) decides what is visible: a venue member
// sees the venue's events, an organizer sees their scoped event. These helpers
// add no authority of their own — they only shape rows for the UI.

export interface ManageableEvent {
  id: string;
  venueId: string;
  venueName: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  status: EventStatus;
  landingActive: boolean;
  landingSlug: string;
  listLocked: boolean;
  /** Scheduled auto-lock instant (#23), or null. */
  autoLockAt: string | null;
  /** The caller is admin of this event's venue. */
  isAdmin: boolean;
  /** The caller is an organizer scoped to this event. */
  isOrganizer: boolean;
}

export interface AdminVenue {
  venueId: string;
  venueName: string;
}

export interface EventTierRow {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  maxGuests: number | null;
  aliases: string[];
  /** Entries occupying the tier (removed/denied excluded — matches the DB). */
  used: number;
}

export interface EventOrganizerRow {
  userId: string;
  fullName: string;
  email: string;
}

export interface AssignableMember {
  userId: string;
  fullName: string;
  email: string;
  roles: VenueRole[];
}

interface MyScope {
  userId: string;
  adminVenueIds: Set<string>;
  organizerEventIds: Set<string>;
}

// The caller's admin venues + organizer event scopes in one pass — used to
// decide which events they may actually manage (not just see).
async function getMyScope(): Promise<MyScope | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = await createClient();

  const [{ data: memberships }, { data: organizing }] = await Promise.all([
    supabase.from('venue_memberships').select('venue_id, roles').eq('user_id', user.id),
    supabase.from('event_organizers').select('event_id').eq('user_id', user.id),
  ]);

  const adminVenueIds = new Set(
    (memberships ?? [])
      .filter((m) => (m.roles as VenueRole[]).includes('admin'))
      .map((m) => m.venue_id)
  );
  const organizerEventIds = new Set((organizing ?? []).map((o) => o.event_id));
  return { userId: user.id, adminVenueIds, organizerEventIds };
}

/** Events the caller may manage (admin of the venue, or organizer of the event). */
export async function getManageableEvents(): Promise<ManageableEvent[]> {
  const scope = await getMyScope();
  if (!scope) return [];
  const supabase = await createClient();

  const { data } = await supabase
    .from('events')
    .select(
      'id, venue_id, name, starts_at, ends_at, status, landing_active, landing_slug, list_locked, auto_lock_at, venues(name)'
    )
    .order('starts_at', { ascending: false });

  return (data ?? [])
    .map((e) => ({
      id: e.id,
      venueId: e.venue_id,
      venueName: e.venues?.name ?? 'Onbekende venue',
      name: e.name,
      startsAt: e.starts_at,
      endsAt: e.ends_at,
      status: e.status,
      landingActive: e.landing_active,
      landingSlug: e.landing_slug,
      listLocked: e.list_locked,
      autoLockAt: e.auto_lock_at,
      isAdmin: scope.adminVenueIds.has(e.venue_id),
      isOrganizer: scope.organizerEventIds.has(e.id),
    }))
    .filter((e) => e.isAdmin || e.isOrganizer);
}

/** Venues where the caller is admin — the only places they may create events. */
export async function getAdminVenues(): Promise<AdminVenue[]> {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('venue_id, roles, venues(name)')
    .eq('user_id', user.id);

  return (data ?? [])
    .filter((m) => (m.roles as VenueRole[]).includes('admin'))
    .map((m) => ({ venueId: m.venue_id, venueName: m.venues?.name ?? 'Onbekende venue' }))
    .sort((a, b) => a.venueName.localeCompare(b.venueName, 'nl'));
}

/** A single event for the management screen, with the caller's role context. */
export async function getManageableEvent(eventId: string): Promise<ManageableEvent | null> {
  const scope = await getMyScope();
  if (!scope) return null;
  const supabase = await createClient();

  const { data: e } = await supabase
    .from('events')
    .select(
      'id, venue_id, name, starts_at, ends_at, status, landing_active, landing_slug, list_locked, auto_lock_at, venues(name)'
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!e) return null;

  return {
    id: e.id,
    venueId: e.venue_id,
    venueName: e.venues?.name ?? 'Onbekende venue',
    name: e.name,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    landingActive: e.landing_active,
    landingSlug: e.landing_slug,
    listLocked: e.list_locked,
    autoLockAt: e.auto_lock_at,
    isAdmin: scope.adminVenueIds.has(e.venue_id),
    isOrganizer: scope.organizerEventIds.has(e.id),
  };
}

/** Tiers of an event with current occupancy (for the tier-max bar). */
export async function getEventTiers(eventId: string): Promise<EventTierRow[]> {
  const supabase = await createClient();

  const [{ data: tiers }, { data: guests }] = await Promise.all([
    supabase
      .from('guest_tiers')
      .select('id, name, description, color, max_guests, aliases')
      .eq('event_id', eventId)
      .order('name'),
    supabase.from('guests').select('tier_id, status').eq('event_id', eventId),
  ]);

  // Occupancy = entries not removed/denied (mirrors guest_tier_contribution).
  const used = new Map<string, number>();
  for (const g of guests ?? []) {
    if (g.status === 'removed' || g.status === 'denied') continue;
    used.set(g.tier_id, (used.get(g.tier_id) ?? 0) + 1);
  }

  return (tiers ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    color: t.color,
    maxGuests: t.max_guests,
    aliases: t.aliases ?? [],
    used: used.get(t.id) ?? 0,
  }));
}

/** Organizers assigned to an event (#6). */
export async function getEventOrganizers(eventId: string): Promise<EventOrganizerRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('event_organizers')
    .select('user_id, user_profiles(full_name, email)')
    .eq('event_id', eventId);

  return (data ?? []).map((row) => ({
    userId: row.user_id,
    fullName: row.user_profiles?.full_name ?? '—',
    email: row.user_profiles?.email ?? '—',
  }));
}

/**
 * Venue members who could be made organizer of this event — the candidate list
 * for "assign existing user". Excludes anyone already organizing it.
 */
export async function getAssignableMembers(
  venueId: string,
  eventId: string
): Promise<AssignableMember[]> {
  const supabase = await createClient();
  const [{ data: members }, { data: organizers }] = await Promise.all([
    supabase
      .from('venue_memberships')
      .select('user_id, roles, user_profiles(full_name, email)')
      .eq('venue_id', venueId),
    supabase.from('event_organizers').select('user_id').eq('event_id', eventId),
  ]);

  const taken = new Set((organizers ?? []).map((o) => o.user_id));
  return (members ?? [])
    .filter((m) => !taken.has(m.user_id))
    .map((m) => ({
      userId: m.user_id,
      fullName: m.user_profiles?.full_name ?? '—',
      email: m.user_profiles?.email ?? '—',
      roles: m.roles as VenueRole[],
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'nl'));
}
