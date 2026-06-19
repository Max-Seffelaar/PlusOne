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
  fetchPoGuests,
  fetchTiers,
  fetchEventQuota,
  type PoQuotaStatus,
} from './queries';
import { toPoEvent, toPoGuest, toPoTier, tierRole } from './adapters';
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
