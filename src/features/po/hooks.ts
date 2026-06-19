'use client';

// React Query READ hooks for the po surface. They bind the browser client and
// the active venue/event scope, then map rows -> po component shapes via the pure
// adapters. No screen calls these yet (STAP 3.2 is infra); STAP 3.3/3.4 swap each
// screen's mock import for the matching hook, preserving the component API.
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Guest, PoEvent, Tier } from '@/lib/po/types';
import { poKeys } from './keys';
import {
  fetchEvents,
  fetchGuests,
  fetchTiers,
  fetchVenueMembers,
  fetchMemberQuotas,
  fetchVenueSettings,
  fetchPendingInvites,
  fetchOwnSessions,
  fetchMyProfile,
  fetchSubscription,
} from './queries';
import {
  toPoEvent,
  toPoGuest,
  toPoTier,
  tierRole,
  toPoTeamMember,
  toPoInvite,
  toPoSession,
  toPoProfile,
  toPoVenueSettings,
  toPoSubscription,
  type PoTeamMember,
  type PoInvite,
  type PoSession,
  type PoProfile,
  type PoVenueSettings,
  type PoSubscription,
} from './adapters';
import { usePoIdentity } from './PoLiveProvider';

/** All events for the caller's active venue. */
export function usePoEvents() {
  const { venueId } = usePoIdentity();
  return useQuery<PoEvent[]>({
    queryKey: poKeys.events(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const rows = await fetchEvents(createClient(), venueId);
      // Headcounts are aggregated when the Events screen wires up (STAP 3.3).
      return rows.map((r) => toPoEvent(r, { guests: 0, inside: 0 }));
    },
  });
}

/** Tiers for an event. */
export function usePoTiers(eventId: string) {
  return useQuery<Tier[]>({
    queryKey: poKeys.tiers(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const rows = await fetchTiers(createClient(), eventId);
      // Used-slot counts are aggregated when the Gastenlijst wires up (STAP 3.4).
      return rows.map((r) => toPoTier(r, 0));
    },
  });
}

/** Guests for an event, with each role badge resolved from its tier. */
export function usePoGuests(eventId: string) {
  return useQuery<Guest[]>({
    queryKey: poKeys.guests(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const client = createClient();
      const [guests, tiers] = await Promise.all([
        fetchGuests(client, eventId),
        fetchTiers(client, eventId),
      ]);
      const roleByTier = new Map(tiers.map((t) => [t.id, tierRole(t.name)]));
      return guests.map((g) => toPoGuest(g, { role: roleByTier.get(g.tier_id) ?? 'Gast' }));
    },
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
