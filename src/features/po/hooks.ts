'use client';

// React Query READ hooks for the po surface. They bind the browser client and
// the active venue/event scope, then map rows -> po component shapes via the pure
// adapters. No screen calls these yet (STAP 3.2 is infra); STAP 3.3/3.4 swap each
// screen's mock import for the matching hook, preserving the component API.
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Guest, PoEvent, Tier } from '@/lib/po/types';
import { poKeys } from './keys';
import { pickDoorEvent, type PoDoorEvent } from './door-event';
import {
  fetchEvents,
  fetchEventForEdit,
  fetchEventHeadcounts,
  fetchOpenRequestCount,
  fetchPastEventStats,
  fetchRecapGuests,
  fetchRecentCheckins,
  fetchTiers,
  fetchTiersWithUsage,
  fetchPoGuests,
  fetchEventQuota,
  fetchVenueMembers,
  fetchMemberQuotas,
  fetchVenueSettings,
  fetchPendingInvites,
  fetchOwnSessions,
  fetchMyProfile,
  fetchSubscription,
  type EventEditRow,
  type RecentCheckinRow,
  type PoQuotaStatus,
} from './queries';
import {
  toPoEvent,
  toPoGuest,
  toPoTier,
  toRecap,
  tierRole,
  toPoTeamMember,
  toPoInvite,
  toPoSession,
  toPoProfile,
  toPoVenueSettings,
  toPoSubscription,
  type PoRecap,
  type PoTeamMember,
  type PoInvite,
  type PoSession,
  type PoProfile,
  type PoVenueSettings,
  type PoSubscription,
} from './adapters';
import { usePoIdentity } from './PoLiveProvider';

/** All events for the caller's active venue, with on-list + present headcounts. */
export function usePoEvents() {
  const { venueId } = usePoIdentity();
  return useQuery<PoEvent[]>({
    queryKey: poKeys.events(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const client = createClient();
      const rows = await fetchEvents(client, venueId);
      const heads = await fetchEventHeadcounts(client, rows.map((r) => r.id));
      return rows.map((r) => {
        const c = heads.get(r.id) ?? { registered: 0, present: 0 };
        return toPoEvent(r, { guests: c.registered, inside: c.present });
      });
    },
  });
}

/**
 * The event the mobile Deur/Taken tab works (live → soonest upcoming → most
 * recent still-open). Lean read scoped to the active venue; the door's own
 * snapshot/outbox (DoorProvider) loads once this resolves an id. Null when the
 * caller has no venue or only closed events — the tab then shows an empty state.
 */
export function usePoDoorEvent() {
  const { venueId } = usePoIdentity();
  return useQuery<PoDoorEvent | null>({
    queryKey: poKeys.doorEvent(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return null;
      const rows = await fetchEvents(createClient(), venueId);
      return pickDoorEvent(rows, Date.now());
    },
  });
}

/** A single event by id, read from the venue's events list (no extra round-trip). */
export function usePoEvent(eventId: string) {
  const { data, isLoading, isError, error } = usePoEvents();
  return {
    event: data?.find((e) => e.id === eventId) ?? null,
    isLoading,
    isError,
    error,
    /** List loaded but this id isn't visible (deleted / out of scope). */
    notFound: !isLoading && !isError && !!data && !data.some((e) => e.id === eventId),
  };
}

export interface PoEventDetail {
  /** Most recent non-voided check-ins ("Laatst binnen"). */
  recent: RecentCheckinRow[];
  /** Open (pending) guest requests ("Aandacht nodig"). */
  openRequests: number;
}

/** Live secondary data for the event-detail screen (recent check-ins + open requests). */
export function usePoEventDetail(eventId: string) {
  return useQuery<PoEventDetail>({
    queryKey: poKeys.eventDetail(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const client = createClient();
      const [recent, openRequests] = await Promise.all([
        fetchRecentCheckins(client, eventId, 3),
        fetchOpenRequestCount(client, eventId),
      ]);
      return { recent, openRequests };
    },
  });
}

/** Past-event recap: summary + per-tier stats + on-list guest lists. */
export function usePoEventRecap(eventId: string) {
  return useQuery<PoRecap>({
    queryKey: poKeys.eventRecap(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const client = createClient();
      const [{ summary, tiers }, guests] = await Promise.all([
        fetchPastEventStats(client, eventId),
        fetchRecapGuests(client, eventId),
      ]);
      return toRecap(summary, guests, tiers);
    },
  });
}

/** Tiers for an event, with live occupancy ("used" = entries not removed/denied). */
export function usePoTiers(eventId: string) {
  return useQuery<Tier[]>({
    queryKey: poKeys.tiers(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const rows = await fetchTiersWithUsage(createClient(), eventId);
      return rows.map((r) => toPoTier(r, r.used));
    },
  });
}

/**
 * A single event's editable fields + whether the caller may manage it (admin of
 * the venue, or organizer of the event). RLS is still the boundary — this only
 * decides which write affordances the form shows.
 */
export function usePoEventForEdit(eventId: string) {
  const { userId, roles } = usePoIdentity();
  const query = useQuery<EventEditRow | null>({
    queryKey: poKeys.event(eventId),
    enabled: !!eventId,
    queryFn: () => fetchEventForEdit(createClient(), eventId, userId),
  });
  const isAdmin = roles.includes('admin');
  return { ...query, isAdmin, canManage: isAdmin || !!query.data?.isOrganizer };
}

/** Guests for an event, with each role badge resolved from its tier. */
export function usePoGuests(eventId: string) {
  return useQuery<Guest[]>({
    queryKey: poKeys.guests(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const client = createClient();
      const [guests, tiers] = await Promise.all([
        fetchPoGuests(client, eventId),
        fetchTiers(client, eventId),
      ]);
      const roleByTier = new Map(tiers.map((t) => [t.id, tierRole(t.name)]));
      return guests.map((g) => toPoGuest(g, { role: roleByTier.get(g.tier_id) ?? 'Gast' }));
    },
  });
}

/** The caller's personal quota for an event (#22/#31) — drives the quick-add hint. */
export function usePoQuota(eventId: string) {
  return useQuery<PoQuotaStatus | null>({
    queryKey: poKeys.quota(eventId),
    enabled: !!eventId,
    queryFn: () => fetchEventQuota(createClient(), eventId),
  });
}

// ── Settings cluster reads (STAP 3.7/3.8) ──
// All scope to the live PoLiveProvider identity (active venue / caller), not the
// mock venue. RLS gates each read, so a member without rights gets [] / null and
// the screen renders its empty or permission state.

/** Team members for the active venue, each with their effective default quota. */
export function usePoTeam() {
  const { venueId } = usePoIdentity();
  return useQuery<PoTeamMember[]>({
    queryKey: poKeys.team(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const client = createClient();
      const [members, quotas, settings] = await Promise.all([
        fetchVenueMembers(client, venueId),
        fetchMemberQuotas(client, venueId),
        fetchVenueSettings(client, venueId),
      ]);
      const quotaByUser = new Map(quotas.map((q) => [q.user_id, q.default_count]));
      const venueDefault = settings?.default_personal_quota ?? 0;
      return members.map((m) => toPoTeamMember(m, quotaByUser.get(m.user_id) ?? venueDefault));
    },
  });
}

/** Open invitations for the active venue. */
export function usePoInvites() {
  const { venueId } = usePoIdentity();
  return useQuery<PoInvite[]>({
    queryKey: poKeys.invites(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const rows = await fetchPendingInvites(createClient(), venueId);
      return rows.map(toPoInvite);
    },
  });
}

/** The caller's own active sessions (newest activity first). */
export function usePoSessions() {
  return useQuery<PoSession[]>({
    queryKey: poKeys.sessions(),
    queryFn: async () => {
      const rows = await fetchOwnSessions(createClient());
      return rows.map(toPoSession);
    },
  });
}

/** The caller's own profile + whether MFA is mandatory for their role. */
export function usePoProfile() {
  const { userId, roles } = usePoIdentity();
  return useQuery<PoProfile | null>({
    queryKey: poKeys.profile(userId),
    enabled: !!userId,
    queryFn: async () => {
      const row = await fetchMyProfile(createClient(), userId);
      return row ? toPoProfile(row, roles) : null;
    },
  });
}

/** Venue settings for the active venue (any member reads; only admin edits). */
export function usePoVenueSettings() {
  const { venueId } = usePoIdentity();
  return useQuery<PoVenueSettings | null>({
    queryKey: poKeys.venueSettings(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return null;
      const row = await fetchVenueSettings(createClient(), venueId);
      return row ? toPoVenueSettings(row) : null;
    },
  });
}

/** The active venue's subscription entitlement (read-only, #32). */
export function usePoSubscription() {
  const { venueId, venueName } = usePoIdentity();
  return useQuery<PoSubscription | null>({
    queryKey: poKeys.subscription(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return null;
      const row = await fetchSubscription(createClient(), venueId);
      return toPoSubscription(row, venueName ?? '');
    },
  });
}
