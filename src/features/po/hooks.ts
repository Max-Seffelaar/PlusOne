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
  type EventEditRow,
  type RecentCheckinRow,
  type PoQuotaStatus,
} from './queries';
import { toPoEvent, toPoGuest, toPoTier, toRecap, tierRole, type PoRecap } from './adapters';
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
