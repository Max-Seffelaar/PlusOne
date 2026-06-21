'use client';

// React Query READ hooks for the po surface. They bind the browser client and
// the active venue/event scope, then map rows -> po component shapes via the pure
// adapters. No screen calls these yet (STAP 3.2 is infra); STAP 3.3/3.4 swap each
// screen's mock import for the matching hook, preserving the component API.
import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  fetchCheckinArrivals,
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
  fetchUserSessions,
  fetchMyProfile,
  fetchSubscription,
  fetchPoAuditFeed,
  fetchPoAuditFilterOptions,
  fetchPoGuestHistory,
  type EventEditRow,
  type CheckinArrival,
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
  type HomeEvent,
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
import { fetchEventStats } from '@/features/stats/data';
import { eventKpis, toPerKwartier, type PerKwartier } from '@/features/stats/po-adapter';
import { getDoorClient } from '@/features/door/offline/device';

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

/** Home polling cadence: keep "aanwezig"/"aanvragen" current without realtime
 *  (realtime stays in the door, #25). React Query pauses this while the tab/window
 *  is hidden (refetchIntervalInBackground defaults false) — Capacitor-safe (#37) —
 *  and it only runs while the Start screen is mounted (other tabs unmount it). */
const HOME_POLL_MS = 10_000;

export interface PoHomeEvents {
  /** Candidate events (not closed), role-scoped headcounts attached, ordered
   *  live-first then soonest — the set the home can feature / switch between. */
  events: HomeEvent[];
  /** The default featured event (live → soonest upcoming → most recent open). */
  defaultId: string | null;
}

/**
 * Mobile Dashboard-home (S11) candidate events for the active venue: every
 * non-closed event with the SAME role-scoped headcounts the Events cards use
 * (fetchEventHeadcounts), so the home is consistent with the Events tab and works
 * for doorhosts (event_stats_summary would 0 them out). The default pick mirrors
 * the Deur tab (pickDoorEvent), so the home and the door agree on "tonight".
 */
export function usePoHomeEvents() {
  const { venueId } = usePoIdentity();
  return useQuery<PoHomeEvents>({
    queryKey: poKeys.home(venueId ?? ''),
    enabled: !!venueId,
    refetchInterval: HOME_POLL_MS,
    queryFn: async () => {
      if (!venueId) return { events: [], defaultId: null };
      const client = createClient();
      const rows = await fetchEvents(client, venueId);
      const heads = await fetchEventHeadcounts(
        client,
        rows.map((r) => r.id)
      );
      const events: HomeEvent[] = rows
        .filter((r) => r.status !== 'closed')
        .map((r) => {
          const c = heads.get(r.id) ?? { registered: 0, present: 0 };
          return { ...r, registered: c.registered, present: c.present };
        })
        // Live first, then soonest start — the order the picker shows.
        .sort((a, b) => {
          const live = (a.status === 'live' ? 0 : 1) - (b.status === 'live' ? 0 : 1);
          if (live !== 0) return live;
          return new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime();
        });
      const picked = pickDoorEvent(rows, Date.now());
      return { events, defaultId: picked?.id ?? events[0]?.id ?? null };
    },
  });
}

export interface PoHomeStats {
  /** Open (pending) guest requests on the selected event. */
  openRequests: number;
  /** The caller's personal quota on the selected event (#22/#31). */
  quota: PoQuotaStatus | null;
}

/**
 * The selected event's KPI bundle (open requests + personal quota), keyed by the
 * event so switching the featured event refetches just these — the headcounts
 * already live in usePoHomeEvents. Each read is RLS-scoped (0/null when denied).
 */
export function usePoHomeStats(eventId: string | null) {
  return useQuery<PoHomeStats>({
    queryKey: poKeys.homeStats(eventId ?? ''),
    enabled: !!eventId,
    refetchInterval: HOME_POLL_MS,
    queryFn: async () => {
      const client = createClient();
      const [openRequests, quota] = await Promise.all([
        fetchOpenRequestCount(client, eventId ?? ''),
        fetchEventQuota(client, eventId ?? ''),
      ]);
      return { openRequests, quota };
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

// ── Event-dag cockpit (S13) ──────────────────────────────────────────────────

export interface PoEventStats {
  /** Check-ins per 15-min bucket ({ t:"23:30", n:38 }); [] before the first check-in. */
  perKwartier: PerKwartier[];
  /** Peak bucket label ("23:00") or null before any check-in. */
  peak: string | null;
  peakCount: number;
}

/**
 * Live event-day stats for the cockpit chart (#26). The analytics RPCs are
 * SECURITY DEFINER and self-gate on role (admin/finance, or organizer for the
 * event), so a caller without access gets empty rows here — never an error; the
 * cockpit then shows the chart's empty state. Short staleTime so it tracks the
 * night; the realtime hook also invalidates it on each check-in.
 */
export function usePoEventStats(eventId: string) {
  return useQuery<PoEventStats>({
    queryKey: poKeys.eventStats(eventId),
    enabled: !!eventId,
    staleTime: 15_000,
    queryFn: async () => {
      const { summary, perQuarter } = await fetchEventStats(createClient(), eventId);
      const k = eventKpis(summary);
      return { perKwartier: toPerKwartier(perQuarter), peak: k.peak, peakCount: k.peakCount };
    },
  });
}

/**
 * Active check-in arrivals per guest — actual present koppen + partial-arrival
 * display (S13). RLS gates check_ins reads (admin/finance/doorhost/organizer); a
 * role without access gets an empty map and the cockpit falls back to the full
 * registered party for headcounts.
 */
export function usePoCheckinArrivals(eventId: string) {
  return useQuery<Map<string, CheckinArrival>>({
    queryKey: poKeys.arrivals(eventId),
    enabled: !!eventId,
    staleTime: 10_000,
    queryFn: () => fetchCheckinArrivals(createClient(), eventId),
  });
}

/**
 * Keep the cockpit live: subscribe to this event's guests changes (the check-in
 * trigger flips guests.status) AND to check_ins (top-ups/voids touch check_ins
 * without a status move), invalidating the guest list + tier counts + arrivals +
 * stats. Mirrors the door's realtime setup (useDoorSync) — JWT set before
 * subscribe, the shared device-scoped client — but the cockpit needs no outbox, so
 * refetch-on-change is enough. Returns the channel state for the "live" indicator.
 */
export function usePoEventRealtime(eventId: string): { realtimeConnected: boolean } {
  const qc = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    const client = getDoorClient();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;

    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) client.realtime.setAuth(token);

      const invalidate = (): void => {
        void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.arrivals(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.eventStats(eventId) });
      };

      channel = client
        .channel(`eventday:${eventId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${eventId}` },
          invalidate
        )
        .on('postgres_changes', { event: '*', schema: 'public', table: 'check_ins' }, invalidate)
        .subscribe((st) => {
          if (!cancelled) setRealtimeConnected(st === 'SUBSCRIBED');
        });
    });

    return () => {
      cancelled = true;
      setRealtimeConnected(false);
      if (channel) void client.removeChannel(channel);
    };
  }, [eventId, qc]);

  return { realtimeConnected };
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

/**
 * A team member's active sessions for the admin remote-logout screen (#20 §5).
 * Admin-at-a-shared-venue + AAL2 are enforced in the RPC; the caller passes
 * `enabled` (isAdmin && AAL2 && a selected member) so we never fire the
 * guaranteed-empty query. Never reports "current" — it is someone else's session.
 */
export function usePoUserSessions(targetUserId: string | null, options?: { enabled?: boolean }) {
  return useQuery<PoSession[]>({
    queryKey: poKeys.userSessions(targetUserId ?? ''),
    enabled: !!targetUserId && (options?.enabled ?? true),
    queryFn: async () => {
      const rows = await fetchUserSessions(createClient(), targetUserId ?? '');
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
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  const { venueId } = usePoIdentity();
  return useQuery<AuditLine[]>({
    queryKey: poKeys.audit(venueId ?? '', filters),
    enabled: !!venueId && (options?.enabled ?? true),
    // Only the home's mini-feed passes an interval; the full audit screen omits it.
    refetchInterval: options?.refetchInterval,
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
