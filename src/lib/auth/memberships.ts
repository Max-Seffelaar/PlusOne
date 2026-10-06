import 'server-only';

import { cache } from 'react';
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

/** A membership row plus the onboarding inputs of its venue (see below). */
export interface MembershipWithVenueState extends Membership {
  /** `venues.settings` — the onboarding gate reads `settings.onboarding`. */
  venueSettings: unknown;
  /** `subscriptions.plan_id` of the venue (1:1), null when none is readable. */
  planId: string | null;
}

// The caller's own memberships, with the venue's onboarding state embedded —
// ONE `venue_memberships` read per request (React `cache()`, Snelheid P1, perf
// audit finding 2). The `/app` layout used to read this table three times per
// document (onboarding, reporting venues, the access set) and then a separate
// `venues` read for the onboarding gate; the embed carries exactly what that
// read selected (`settings`, `subscriptions(plan_id)`) under the same RLS
// (embedded rows obey their own table's policies, as the `.in()` read did).
export const getMyMembershipsWithVenueState = cache(async (): Promise<MembershipWithVenueState[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('venue_memberships')
    .select('venue_id, roles, venues(name, settings, subscriptions(plan_id))')
    .eq('user_id', user.id);

  return (data ?? []).map((row) => {
    // subscriptions is 1:1 with venue (unique venue_id), so it resolves to a
    // single row (or null) under detect_one_to_one_relationships.
    const sub = Array.isArray(row.venues?.subscriptions) ? row.venues?.subscriptions[0] : row.venues?.subscriptions;
    return {
      venueId: row.venue_id,
      venueName: row.venues?.name ?? 'Unknown venue',
      roles: row.roles,
      venueSettings: row.venues?.settings ?? null,
      planId: sub?.plan_id ?? null,
    };
  });
});

// The caller's own memberships (RLS: a user always sees their own). Drives the
// venue switcher and "which venues do I manage" decisions. Same cached read as
// above, projected to the plain Membership shape.
export async function getMyMemberships(): Promise<Membership[]> {
  const rows = await getMyMembershipsWithVenueState();
  return rows.map(({ venueId, venueName, roles }) => ({ venueId, venueName, roles }));
}

// Venues the caller can reach as EXTERNAL CREW only: they organize ≥1 event there
// but hold no venue membership (#24 + 86ey21vre). Returned as memberships with an
// empty roles array, so they appear in the venue switcher and can be the active
// venue, but every role-gated capability stays off (event-scoped access only). RLS
// is the boundary: own organizer rows are readable, and the venue/events are visible
// via organizes_event_at_venue / is_event_organizer.
// Cached per request (Snelheid P1): the layout and the onboarding gate share it.
export const getOrganizerVenues = cache(async (): Promise<Membership[]> => {
  const user = await getSessionUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from('event_organizers')
    .select('events!inner(venue_id, venues(name))')
    .eq('user_id', user.id);

  const byVenue = new Map<string, string>();
  for (const row of data ?? []) {
    const ev = row.events;
    if (ev?.venue_id) byVenue.set(ev.venue_id, ev.venues?.name ?? 'Unknown venue');
  }
  return [...byVenue].map(([venueId, venueName]) => ({ venueId, venueName, roles: [] as VenueRole[] }));
});

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

// ── PlusOne platform (system) admin support-access (P-02/P-05) ──────────────

// Whether the signed-in user is a PlusOne platform admin. Reads the caller's
// OWN user_profiles row (RLS: always readable), so this is one cheap select —
// never a service-role bypass. Mirrors `fetchIsPlatformAdmin` in
// `src/features/po/queries.ts`, which reads the same column over the browser
// client for the UI gate; this is the server-side counterpart used by the
// venue-switch action + layout below.
export async function isPlatformAdminServer(): Promise<boolean> {
  const user = await getSessionUser();
  if (!user) return false;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('user_profiles')
    .select('is_platform_admin')
    .eq('id', user.id)
    .maybeSingle();
  // Throw on a read error rather than reading it as "not a platform admin":
  // `switchActiveVenueAction` decides whether a `platform_access_log` row is
  // owed from this, and a silent false would switch a platform admin in
  // without one (fail-open). Every caller tolerates the throw:
  // `getPlatformAdminVenue`'s callers (actions.ts, app/app/layout.tsx) both
  // `.catch(() => null)`, and the crew path of the switch action lets it
  // propagate so the switch fails closed.
  if (error) throw error;
  return data?.is_platform_admin === true;
}

/**
 * A venue a platform admin may switch into even though they hold no
 * `venue_memberships` row there — support/debug access (decision #49). Returns
 * `roles: []`, the SAME shape `getOrganizerVenues()` already returns for
 * external-crew access: every role-gated capability elsewhere stays off,
 * which is a known, pre-existing limitation of that shape (not new here) —
 * RLS itself already lets a platform admin read/write past it regardless.
 *
 * Returns null for anyone who is not a platform admin, or for a venue id that
 * doesn't exist — the caller treats null exactly like "not reachable".
 */
export async function getPlatformAdminVenue(venueId: string): Promise<Membership | null> {
  if (!(await isPlatformAdminServer())) return null;
  const supabase = await createClient();
  const { data } = await supabase.from('venues').select('id, name').eq('id', venueId).maybeSingle();
  if (!data) return null;
  return { venueId: data.id, venueName: data.name, roles: [] };
}
