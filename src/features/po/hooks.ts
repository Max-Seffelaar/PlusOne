'use client';

// React Query READ hooks for the po surface. They bind the browser client and
// the active venue/event scope, then map rows -> po component shapes via the pure
// adapters. No screen calls these yet (STAP 3.2 is infra); STAP 3.3/3.4 swap each
// screen's mock import for the matching hook, preserving the component API.
import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Guest, PoEvent, Tier } from '@/lib/po/types';
import type { AuditLine } from '@/features/audit/translate';
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
  fetchGuestRequests,
  fetchQuotaRequests,
  fetchContacts,
  fetchContactKeyRows,
  fetchVenueMembers,
  fetchMemberQuotas,
  fetchVenueSettings,
  fetchPendingInvites,
  fetchOwnSessions,
  fetchMyProfile,
  fetchSubscription,
  fetchPoAuditFeed,
  fetchPoAuditFilterOptions,
  fetchPoGuestHistory,
  type EventEditRow,
  type RecentCheckinRow,
  type PoQuotaStatus,
  type PoAuditFilters,
  type PoAuditFilterOptions,
  type PoGuestHistory,
} from './queries';
import {
  toPoEvent,
  toPoGuest,
  toPoTier,
  toPoContact,
  toPoGuestRequest,
  toPoQuotaRequest,
  toRecap,
  tierRole,
  toPoTeamMember,
  toPoInvite,
  toPoSession,
  toPoProfile,
  toPoVenueSettings,
  toPoSubscription,
  type PoContact,
  type PoGuestRequest,
  type PoQuotaRequest,
  type PoRecap,
  type PoTeamMember,
  type PoInvite,
  type PoSession,
  type PoProfile,
  type PoVenueSettings,
  type PoSubscription,
} from './adapters';
import { normalizeEmail, normalizePhoneToDigits } from '@/features/contacts/import/parse';
import { usePoIdentity } from './PoLiveProvider';

/** Existing-contact dedup keys for the import preview, mirroring the DB's
 *  email-first-else-phone matching (upsert_contacts). Two sets so a parsed row can
 *  hit on either, exactly like the RPC. */
export interface ContactDedupeKeys {
  emails: Set<string>;
  phones: Set<string>;
}

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

// ── Approvals reads (S5 Aanvragen, STAP 3.6) ──
// Read VENUE-WIDE across all of the active venue's events (ids from usePoEvents,
// already RLS-scoped to the venue), so the inbox can show "Alle events" + an
// event picker. RLS still gates the requests themselves: a role without rights
// gets [], so the screen shows an empty tab rather than an error. The mutation
// hooks invalidate the [...all,'requests'] / [...all,'quota-requests'] prefix,
// which matches these venue keys, so a decided request drops off on success.

/** Pending landing-page guest requests across the active venue's events. */
export function usePoGuestRequests() {
  const { venueId } = usePoIdentity();
  const events = usePoEvents();
  const eventIds = (events.data ?? []).map((e) => e.id);
  return useQuery<PoGuestRequest[]>({
    queryKey: poKeys.requests(venueId ?? ''),
    enabled: !!venueId && events.isSuccess,
    queryFn: async () => {
      const rows = await fetchGuestRequests(createClient(), eventIds);
      return rows.map((r) => toPoGuestRequest(r));
    },
  });
}

/** Pending quota requests across the active venue's events. */
export function usePoQuotaRequests() {
  const { venueId } = usePoIdentity();
  const events = usePoEvents();
  const eventIds = (events.data ?? []).map((e) => e.id);
  return useQuery<PoQuotaRequest[]>({
    queryKey: poKeys.quotaRequests(venueId ?? ''),
    enabled: !!venueId && events.isSuccess,
    queryFn: async () => {
      const rows = await fetchQuotaRequests(createClient(), eventIds);
      return rows.map((r) => toPoQuotaRequest(r));
    },
  });
}

// ── Address book reads (S3 Adresboek + Import, STAP 3.4/3.8) ──
// Scope to the active venue; RLS limits direct contacts reads to admin / finance /
// organizer, so staff/doorhost get [] and the screen renders its empty state.

/**
 * The venue address book. The optional search is server-side (ilike on name); the
 * screen also filters client-side on the last-4 phone hint. One cache per search
 * term, all under the ['po','contacts',venueId] prefix so writes invalidate every
 * variant at once.
 */
export function usePoContacts(search = '') {
  const { venueId } = usePoIdentity();
  return useQuery<PoContact[]>({
    queryKey: poKeys.contacts(venueId ?? '', search),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const rows = await fetchContacts(createClient(), venueId, search);
      return rows.map(toPoContact);
    },
  });
}

/** Permanent contacts only (the "Vaste" screen) — derived from the unsearched list. */
export function usePoPermanentContacts() {
  const query = usePoContacts('');
  return { ...query, data: query.data?.filter((c) => c.vast) };
}

/** Existing-contact dedup keys (e-mail + phone digits) for the import preview. */
export function usePoContactKeys() {
  const { venueId } = usePoIdentity();
  return useQuery<ContactDedupeKeys>({
    queryKey: poKeys.contactKeys(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      const emails = new Set<string>();
      const phones = new Set<string>();
      if (!venueId) return { emails, phones };
      const rows = await fetchContactKeyRows(createClient(), venueId);
      for (const r of rows) {
        const e = normalizeEmail(r.email);
        if (e) emails.add(e);
        const p = normalizePhoneToDigits(r.phone);
        if (p) phones.add(p);
      }
      return { emails, phones };
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

// ── Audit log (S10) reads ────────────────────────────────────────────────────

export interface PoAal2State {
  /** True until the first assurance-level check resolves. */
  loading: boolean;
  /** The browser session has reached AAL2 (MFA-verified). */
  isAal2: boolean;
  /** Re-check after an in-app MFA step-up upgrades the session. */
  recheck: () => void;
}

/**
 * AAL2 (MFA) status of the current browser session — sensitive reads like the
 * audit log require it (#15/#20). Read straight from GoTrue
 * (getAuthenticatorAssuranceLevel), so it is client-only and Capacitor-safe (#37);
 * the screen calls `recheck` after the in-app step-up sheet upgrades the session.
 */
export function usePoAal2(): PoAal2State {
  const [state, setState] = useState<{ loading: boolean; isAal2: boolean }>({
    loading: true,
    isAal2: false,
  });
  const recheck = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    void createClient()
      .auth.mfa.getAuthenticatorAssuranceLevel()
      .then(({ data }) => setState({ loading: false, isAal2: data?.currentLevel === 'aal2' }))
      .catch(() => setState({ loading: false, isAal2: false }));
  }, []);
  useEffect(() => {
    recheck();
  }, [recheck]);
  return { ...state, recheck };
}

/**
 * The active venue's audit feed (S10), filtered + capped in the database. Gated
 * to admin/finance + AAL2 by RLS; the caller passes `enabled` (canAudit && AAL2)
 * so we never fire the guaranteed-empty AAL1 query.
 */
export function usePoAuditFeed(
  filters: Omit<PoAuditFilters, 'venueId'>,
  options?: { enabled?: boolean }
) {
  const { venueId } = usePoIdentity();
  return useQuery<AuditLine[]>({
    queryKey: poKeys.audit(venueId ?? '', filters),
    enabled: !!venueId && (options?.enabled ?? true),
    queryFn: () => fetchPoAuditFeed(createClient(), { venueId: venueId ?? '', ...filters }),
  });
}

/** Events + members for the audit filter sheet (the active venue). */
export function usePoAuditFilterOptions(options?: { enabled?: boolean }) {
  const { venueId } = usePoIdentity();
  return useQuery<PoAuditFilterOptions>({
    queryKey: poKeys.auditOptions(venueId ?? ''),
    enabled: !!venueId && (options?.enabled ?? true),
    queryFn: () => fetchPoAuditFilterOptions(createClient(), venueId ?? ''),
  });
}

/** The per-guest "geschiedenis" timeline (#15) — null guestId keeps it idle. */
export function usePoGuestHistory(guestId: string | null) {
  return useQuery<PoGuestHistory>({
    queryKey: poKeys.guestHistory(guestId ?? ''),
    enabled: !!guestId,
    queryFn: () => fetchPoGuestHistory(createClient(), guestId ?? ''),
  });
}
