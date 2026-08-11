'use client';

// React Query READ hooks for the po surface. They bind the browser client and
// the active venue/event scope, then map rows -> po component shapes via the pure
// adapters. No screen calls these yet (STAP 3.2 is infra); STAP 3.3/3.4 swap each
// screen's mock import for the matching hook, preserving the component API.
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import type { Guest, PoEvent, Tier } from '@/lib/po/types';
import type { AuditLine } from '@/features/audit/translate';
import { poKeys } from './keys';
import { doorCandidates, pickDoorEvent, type PoDoorEvent } from './door-event';
import { eventPhase } from './event-phase';
import {
  fetchEvents,
  fetchEventForEdit,
  fetchEventHeadcounts,
  fetchOpenRequestCount,
  fetchOpenQuotaRequestCount,
  fetchPastEventStats,
  fetchRecapGuests,
  fetchRecentCheckins,
  fetchTiers,
  fetchTiersWithUsage,
  fetchGuests,
  fetchVenueGuestsWindow,
  fetchCheckinArrivals,
  fetchEventQuota,
  fetchGuestRequests,
  fetchQuotaRequests,
  fetchContacts,
  fetchContactKeyRows,
  fetchPersonProfile,
  fetchVenueMembers,
  fetchMemberQuotas,
  fetchVenueSettings,
  fetchEventQuotaOverrides,
  fetchVenueInvites,
  fetchVenueCrew,
  fetchMyPendingInvites,
  fetchOwnSessions,
  fetchUserSessions,
  fetchMyProfile,
  fetchSubscription,
  fetchPoAuditFeed,
  fetchPoAuditFilterOptions,
  fetchPoGuestHistory,
  fetchTemplates,
  fetchTemplate,
  fetchTemplateTiers,
  fetchOrganizesAtVenue,
  fetchOrganizesOpenEventAtVenue,
  fetchOrganizerEventIds,
  fetchEventCrew,
  fetchAssignableCrew,
  fetchRequestLinks,
  fetchVenueRequestLinks,
  fetchVenueInfluencers,
  fetchEventLinkFunnel,
  fetchInfluencerLeaderboard,
  fetchVenueLabelFunnel,
  type PoRequestLink,
  type PoLinkOption,
  type PoInfluencer,
  type PoLinkFunnelRow,
  type PoLeaderboardRow,
  type PoLabelFunnelRow,
  type PoCrewMember,
  type EventEditRow,
  type CheckinArrival,
  type RecentCheckinRow,
  type PoQuotaStatus,
  type PoAuditFilters,
  type PoAuditFilterOptions,
  type PoGuestHistory,
  type PoTemplateRow,
  type PoTemplateDetail,
  type PoTemplateTierRow,
} from './queries';
import {
  toPoEvent,
  toPoGuest,
  toPoTier,
  type HomeEvent,
  toPoContact,
  toPoContactProfile,
  toPoGuestRequest,
  toPoQuotaRequest,
  toRecap,
  tierRole,
  toPoTeamMember,
  toPoInvite,
  toPoVenueCrewMember,
  toPoMyInvite,
  toPoSession,
  toPoProfile,
  toPoVenueSettings,
  toPoSubscription,
  type PoContact,
  type PoContactProfile,
  type PoGuestRequest,
  type PoQuotaRequest,
  type PoRecap,
  type PoTeamMember,
  type PoInvite,
  type PoVenueCrewMember,
  type PoMyInvite,
  type PoSession,
  type PoProfile,
  type PoVenueSettings,
  type PoSubscription,
} from './adapters';
import { normalizeEmail, normalizePhoneToDigits } from '@/features/contacts/import/parse';
import { usePoIdentity } from './PoLiveProvider';
import { canWorkDoor } from '@/features/auth/roles';
import { fetchEventStats } from '@/features/stats/data';
import {
  eventKpis,
  toPerKwartier,
  toPerTier,
  toPerUser,
  type EventKpis,
  type PerKwartier,
  type PerTier,
  type PerUser,
} from '@/features/stats/po-adapter';
import { getDoorClient } from '@/features/door/offline/device';
import { shouldRefetchOnStatus, type ChannelStatus } from '@/features/door/sync/reconnect';

/** Existing-contact dedup keys for the import preview, mirroring the DB's
 *  email-first-else-phone matching (upsert_contacts). Two sets so a parsed row can
 *  hit on either, exactly like the RPC. */
export interface ContactDedupeKeys {
  emails: Set<string>;
  phones: Set<string>;
}

// Stable empty-array fallbacks (86ey9e9vc review, Step 5b) — `.data` is
// `undefined` while a query is disabled/loading, and every one of
// usePoEvents/usePoDoorCandidates' ~16 call sites across the app was doing
// its OWN local `?? []`, minting a fresh array reference each render. Fixing
// it once here, at the source, means every existing call site benefits
// without needing an edit — a local `?? []` downstream still works, it's
// just redundant now.
const EMPTY_EVENTS: PoEvent[] = [];
const EMPTY_DOOR_CANDIDATES: PoDoorEvent[] = [];

/** All events for the caller's active venue, with on-list + present headcounts. */
export function usePoEvents() {
  const { venueId } = usePoIdentity();
  const query = useQuery<PoEvent[]>({
    queryKey: poKeys.events(venueId ?? ''),
    enabled: !!venueId,
    // Explicit list (86ey9e9vc review round 2), audited against every one of
    // this hook's ~15 call sites — none reads anything else off the returned
    // object. Required for the `{ ...query, ... }` spread below to stay safe:
    // without it, v5's tracked-properties Proxy (`trackResult`) marks a
    // consumer subscribed to EVERY property the spread touches (`fetchStatus`,
    // `isFetching`, `dataUpdatedAt`, `promise`, …), so a plain refetch/
    // invalidation re-rendered every consumer even when `data` itself hadn't
    // changed — the same class of bug this whole PR exists to fix. `error` is
    // included because `usePoEvent` below destructures it even though none of
    // ITS callers currently re-export it further. `isSuccess` is included for
    // the same reason `usePoDoorCandidates` needs it (see that hook's comment,
    // review round 2 Blocker 2): `usePoEvent`'s `notFound` below gates on it.
    notifyOnChangeProps: ['data', 'isLoading', 'isError', 'error', 'isSuccess'],
    queryFn: async () => {
      if (!venueId) return [];
      const client = createClient();
      // SCALE-5: both reads take just the venueId now (no more eventIds handoff
      // from fetchEvents into fetchEventHeadcounts), so they run in parallel.
      const [rows, heads] = await Promise.all([
        fetchEvents(client, venueId),
        fetchEventHeadcounts(client, venueId),
      ]);
      return rows.map((r) => {
        const c = heads.get(r.id) ?? { registered: 0, present: 0 };
        return toPoEvent(r, { guests: c.registered, inside: c.present });
      });
    },
  });
  return { ...query, data: query.data ?? EMPTY_EVENTS };
}

/** Home polling cadence: keep "aanwezig"/"aanvragen" current without realtime
 *  (realtime stays in the door, #25). React Query pauses this while the tab/window
 *  is hidden (refetchIntervalInBackground defaults false) — Capacitor-safe (#37) —
 *  and it only runs while the Start screen is mounted (other tabs unmount it). */
const HOME_POLL_MS = 10_000;

/** How far back the po hooks that poll/refresh events look (86ey9e8gt) — matches
 *  the Home board's own display cutoff (PAST_WINDOW_MS in screens/home.tsx):
 *  anything older is a history concern, not a "keep this current" concern, so the
 *  query never has to scan the venue's full event history to serve it. Shared
 *  here (not re-derived per caller) so the query window and the display window
 *  can't drift apart. */
export const RECENT_EVENTS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function recentEventsSinceIso(): string {
  return new Date(Date.now() - RECENT_EVENTS_WINDOW_MS).toISOString();
}

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
  const { venueId, userId, roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  return useQuery<PoHomeEvents>({
    queryKey: poKeys.home(venueId ?? ''),
    enabled: !!venueId,
    refetchInterval: HOME_POLL_MS,
    queryFn: async () => {
      if (!venueId) return { events: [], defaultId: null };
      const client = createClient();
      const sinceIso = recentEventsSinceIso();
      // Admin already manages everything — skip the extra read. Otherwise one
      // venue-scoped fetch of the caller's own organizer rows (86ey9tkav),
      // not an N+1 per card, so the board can gate Edit/Lock per event.
      const [rows, heads, organizerIds] = await Promise.all([
        fetchEvents(client, venueId, sinceIso),
        fetchEventHeadcounts(client, venueId, sinceIso),
        isAdmin || !userId ? Promise.resolve(new Set<string>()) : fetchOrganizerEventIds(client, venueId, userId),
      ]);
      const now = Date.now();
      const events: HomeEvent[] = rows
        .filter((r) => r.cancelled_at == null)
        .map((r) => {
          const c = heads.get(r.id) ?? { registered: 0, present: 0 };
          return {
            ...r,
            registered: c.registered,
            present: c.present,
            canManage: isAdmin || organizerIds.has(r.id),
          };
        })
        // Live first, then soonest start — the order the picker shows.
        .sort((a, b) => {
          const liveA = eventPhase(a.starts_at, a.ends_at, now) === 'live' ? 0 : 1;
          const liveB = eventPhase(b.starts_at, b.ends_at, now) === 'live' ? 0 : 1;
          if (liveA !== liveB) return liveA - liveB;
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
 * Every non-closed event the door/cockpit may work (live first, then soonest),
 * for the Deur-tab event switcher (S1.3). Lean read scoped to the active venue;
 * lets the user deliberately pick which event they are doing the door for when
 * several are live, instead of the automatic pickDoorEvent guess.
 */
export function usePoDoorCandidates() {
  const { venueId } = usePoIdentity();
  const query = useQuery<PoDoorEvent[]>({
    queryKey: poKeys.doorCandidates(venueId ?? ''),
    enabled: !!venueId,
    // Explicit list (86ey9e9vc review round 2) — see usePoEvents' comment
    // above for why. Audited: app.tsx (the only call site reading more than
    // `data`/`isLoading`) also reads `isFetching` (a stale-door-refetch
    // effect dep), `isSuccess` (the T6 auto-open effect's load-state guard —
    // review round 2, Blocker 2), and calls `.refetch()` imperatively — a
    // stable method reference, not gated by this list.
    notifyOnChangeProps: ['data', 'isLoading', 'isFetching', 'isSuccess'],
    queryFn: async () => {
      if (!venueId) return [];
      return doorCandidates(await fetchEvents(createClient(), venueId), Date.now());
    },
  });
  return { ...query, data: query.data ?? EMPTY_DOOR_CANDIDATES };
}

/** A single event by id, read from the venue's events list (no extra round-trip). */
export function usePoEvent(eventId: string) {
  const { data, isLoading, isError, error, isSuccess } = usePoEvents();
  return {
    event: data.find((e) => e.id === eventId) ?? null,
    isLoading,
    isError,
    error,
    // Gate on the query's own `isSuccess`, not `!isLoading` (86ey9e9vc review
    // round 2, finding 5 — the exact Blocker-2 trap): with `enabled: !!venueId`
    // and no venueId yet resolved (a brand-new session, or `resolveActiveVenueId`
    // catching an error to null), the query is `status: 'pending'`,
    // `fetchStatus: 'idle'` — `isLoading = isPending && isFetching` is FALSE
    // for a disabled query, same as for a settled one. `data` is never
    // undefined (usePoEvents' stable-empty-array fallback), so `!isLoading`
    // alone can no longer tell "never ran" apart from "ran, id not in it".
    /** List loaded but this id isn't visible (deleted / out of scope). */
    notFound: isSuccess && !data.some((e) => e.id === eventId),
  };
}

export interface PoEventDetail {
  /** Most recent non-voided check-ins ("Laatst binnen"). */
  recent: RecentCheckinRow[];
  /** Open (pending) guest requests ("Aandacht nodig"). */
  openRequests: number;
  /** Open (pending) quota requests — counted with the guest requests in the
   *  admin badge (86ey8w7bm: they were invisible on the event page). */
  openQuotaRequests: number;
}

/** Live secondary data for the event-detail screen (recent check-ins + open requests). */
export function usePoEventDetail(eventId: string) {
  return useQuery<PoEventDetail>({
    queryKey: poKeys.eventDetail(eventId),
    enabled: !!eventId,
    queryFn: async () => {
      const client = createClient();
      const [recent, openRequests, openQuotaRequests] = await Promise.all([
        fetchRecentCheckins(client, eventId, 3),
        fetchOpenRequestCount(client, eventId),
        fetchOpenQuotaRequestCount(client, eventId),
      ]);
      return { recent, openRequests, openQuotaRequests };
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

/** The one per-event-stats shape shared by the event-home Activity panel and the
 *  Analytics event-first view (M6, 86ey7dzmp) — same fetch, same adapters, so the
 *  two surfaces can never drift apart (K-10-les). */
export interface EventStatsDetail {
  ek: EventKpis;
  perKwartier: PerKwartier[];
  perTier: PerTier[];
  perUser: PerUser[];
}

/** Raw shape behind BOTH `usePoEventStats` (cockpit chart) and `usePoEventActivity`
 *  (Activity panel / Analytics event-first view) — they used to call the identical
 *  `fetchEventStats` 5-RPC bundle independently under two different cache keys
 *  (86ey9e9v5), so mounting both duplicated the fetch, and an invalidation of one
 *  key (e.g. the check-in realtime hook, which only ever touched `eventStats`)
 *  silently left the other stale. Sharing `poKeys.eventStats` as the queryKey and
 *  varying the shape per hook with `select` (CLAUDE.md's "share a base query")
 *  dedupes the network call and fixes that staleness for free. */
interface EventStatsBundle {
  ek: EventKpis;
  perKwartier: PerKwartier[];
  perTier: PerTier[];
  perUser: PerUser[];
  peak: string | null;
  peakCount: number;
}

async function fetchEventStatsBundle(eventId: string): Promise<EventStatsBundle> {
  const { summary, perQuarter, tiers, users } = await fetchEventStats(createClient(), eventId);
  const ek = eventKpis(summary);
  return {
    ek,
    perKwartier: toPerKwartier(perQuarter),
    perTier: toPerTier(tiers),
    perUser: toPerUser(users),
    peak: ek.peak,
    peakCount: ek.peakCount,
  };
}

/** Per-event KPIs + arrivals + per-tier + per-member stats, for `EventStatsPanel`. */
export function usePoEventActivity(
  eventId: string,
  options?: { enabled?: boolean; refetchInterval?: number }
) {
  return useQuery({
    queryKey: poKeys.eventStats(eventId),
    enabled: !!eventId && (options?.enabled ?? true),
    refetchInterval: options?.refetchInterval,
    queryFn: () => fetchEventStatsBundle(eventId),
    select: (bundle): EventStatsDetail => ({
      ek: bundle.ek,
      perKwartier: bundle.perKwartier,
      perTier: bundle.perTier,
      perUser: bundle.perUser,
    }),
  });
}

/** Tiers for an event, with live occupancy ("used" = entries not removed/denied). */
export function usePoTiers(eventId: string, options?: { refetchInterval?: number }) {
  return useQuery<Tier[]>({
    queryKey: poKeys.tiers(eventId),
    enabled: !!eventId,
    refetchInterval: options?.refetchInterval,
    queryFn: async () => {
      const rows = await fetchTiersWithUsage(createClient(), eventId);
      return rows.map((r) => toPoTier(r, r.used));
    },
  });
}

// ── Event templates (86exyp8gn) ──────────────────────────────────────────────

/** Every reusable template of the active venue. */
export function usePoTemplates() {
  const { venueId } = usePoIdentity();
  return useQuery<PoTemplateRow[]>({
    queryKey: poKeys.templates(venueId ?? ''),
    enabled: !!venueId,
    queryFn: () => (venueId ? fetchTemplates(createClient(), venueId) : Promise.resolve([])),
  });
}

/** A single template's editable fields. */
export function usePoTemplate(templateId: string) {
  return useQuery<PoTemplateDetail | null>({
    queryKey: poKeys.template(templateId),
    enabled: !!templateId,
    queryFn: () => fetchTemplate(createClient(), templateId),
  });
}

/** A template's tier list (seeding order). */
export function usePoTemplateTiers(templateId: string) {
  return useQuery<PoTemplateTierRow[]>({
    queryKey: poKeys.templateTiers(templateId),
    enabled: !!templateId,
    queryFn: () => fetchTemplateTiers(createClient(), templateId),
  });
}

/**
 * Whether the caller may manage this venue's templates (admin OR organizes any
 * event there — mirrors the event_templates RLS). Admins short-circuit the query;
 * organizers resolve via a cheap count of their own event_organizers rows.
 */
export function usePoCanManageTemplates(): boolean {
  const { venueId, userId, roles } = usePoIdentity();
  const isAdmin = roles.includes('admin');
  const { data } = useQuery<boolean>({
    queryKey: [...poKeys.all, 'can-manage-templates', venueId ?? ''],
    enabled: !!venueId && !!userId && !isAdmin,
    queryFn: () =>
      venueId && userId ? fetchOrganizesAtVenue(createClient(), venueId, userId) : Promise.resolve(false),
  });
  return isAdmin || data === true;
}

/**
 * Whether the caller organizes a still-workable event at the active venue (M2,
 * K-6) — drives the Deur-tab gate for an external crew member with no venue
 * role. `canWorkDoor(roles)` short-circuits admin/doorhost so they never pay
 * for the extra read.
 */
export function usePoIsDoorOrganizer(): boolean {
  const { venueId, userId, roles } = usePoIdentity();
  const skip = canWorkDoor(roles);
  const { data } = useQuery<boolean>({
    queryKey: [...poKeys.all, 'is-door-organizer', venueId ?? ''],
    enabled: !!venueId && !!userId && !skip,
    queryFn: () =>
      venueId && userId ? fetchOrganizesOpenEventAtVenue(createClient(), venueId, userId, Date.now()) : Promise.resolve(false),
  });
  return skip || data === true;
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

/** External crew (event_organizers, #6/#24) assigned to an event. RLS limits reads
 *  to members of the event's venue (or the organizer themself). */
export function usePoCrew(eventId: string) {
  return useQuery<PoCrewMember[]>({
    queryKey: poKeys.crew(eventId),
    enabled: !!eventId,
    queryFn: () => fetchEventCrew(createClient(), eventId),
  });
}

/** Team members who can still be added as crew of this event (for the "add an
 *  existing member" path); excludes anyone already on the crew. */
export function usePoAssignableCrew(eventId: string) {
  return useQuery<PoCrewMember[]>({
    queryKey: poKeys.assignableCrew(eventId),
    enabled: !!eventId,
    queryFn: () => fetchAssignableCrew(createClient(), eventId),
  });
}

/** Newest-first ordering for the guest list (feedback 1/7: a just-added guest must
 *  be visible at the top, not buried oldest-first). The reads page oldest-first
 *  (created_at asc, id) for deterministic ranged paging, so we reverse-sort here on
 *  the same keys. Non-mutating (returns a fresh array). */
function sortGuestsNewestFirst<T extends { created_at: string; id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/** Guests for an event, with each role badge resolved from its tier. */
export function usePoGuests(eventId: string, options?: { refetchInterval?: number }) {
  return useQuery<Guest[]>({
    queryKey: poKeys.guests(eventId),
    enabled: !!eventId,
    refetchInterval: options?.refetchInterval,
    queryFn: async () => {
      const client = createClient();
      const [guests, tiers] = await Promise.all([
        fetchGuests(client, eventId),
        fetchTiers(client, { eventId }),
      ]);
      const tierById = new Map(tiers.map((t) => [t.id, t]));
      return sortGuestsNewestFirst(guests).map((g) =>
        toPoGuest(g, {
          role: tierRole(tierById.get(g.tier_id)?.name ?? '').role,
          tierName: tierById.get(g.tier_id)?.name,
          tierColor: tierById.get(g.tier_id)?.color ?? undefined,
        }),
      );
    },
  });
}

export interface VenueGuests {
  /** The windowed working set, already newest-first (server-ordered). */
  guests: Guest[];
  /** Total matching guests venue-wide (respects `search` + RLS) — backs the
   *  "of N" subtitle; ≥ guests.length when there's more beyond the window. */
  total: number;
}

/**
 * The venue-wide "all guests" working set (Guests tab, no event selected): the
 * newest VENUE_GUESTS_WINDOW guests across the venue, with name search pushed to
 * the server so it reaches past the window (86ey9e8hz — was an unbounded
 * page-the-whole-venue read + client re-sort/-filter that died at 25 000 guests).
 * Each row carries its event id + name to badge + deep-link, and its tier from
 * the embed (no separate venue-wide tier read). `total` backs the "of N"
 * subtitle. RLS stays the boundary (staff see only their own). Pass `[]` to
 * disable (single-event mode); `search` is the debounced term, and a new term is
 * a new server window keyed under the same prefix so writes still invalidate it.
 */
export function useVenueGuests(events: PoEvent[], search = '') {
  const { venueId } = usePoIdentity();
  const nameById = new Map(events.map((e) => [e.id, e.name]));
  return useQuery<VenueGuests>({
    queryKey: poKeys.venueGuests(venueId ?? '', search),
    enabled: !!venueId && events.length > 0,
    queryFn: async () => {
      const { rows, total } = await fetchVenueGuestsWindow(createClient(), {
        venueId: venueId ?? '',
        search,
      });
      const guests = rows.map((g) =>
        toPoGuest(g, {
          role: tierRole(g.tierName ?? '').role,
          tierName: g.tierName ?? undefined,
          tierColor: g.tierColor ?? undefined,
          eventId: g.event_id,
          eventName: nameById.get(g.event_id) ?? '',
        }),
      );
      return { guests, total };
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
 * night; the (throttled) realtime hook also invalidates it on check-ins, and the
 * cockpit can pass refetchInterval as a safety net.
 */
export function usePoEventStats(eventId: string, options?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: poKeys.eventStats(eventId),
    enabled: !!eventId,
    staleTime: 15_000,
    refetchInterval: options?.refetchInterval,
    queryFn: () => fetchEventStatsBundle(eventId),
    select: (bundle): PoEventStats => ({
      perKwartier: bundle.perKwartier,
      peak: bundle.peak,
      peakCount: bundle.peakCount,
    }),
  });
}

/** Content-equal check so a refetch that changed nothing keeps the old Map
 *  reference — React Query's default structural sharing only deep-compares
 *  plain objects/arrays, so a fresh `Map` from every fetchCheckinArrivals call
 *  otherwise gets a new identity even when every entry is unchanged, defeating
 *  the arrivals-keyed memos downstream (tiles/tierRows, R6/86ey9e8fe). */
export function arrivalsEqual(a: Map<string, CheckinArrival>, b: Map<string, CheckinArrival>): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [guestId, arrival] of a) {
    const other = b.get(guestId);
    // id included: a same-count, same-time arrival on a DIFFERENT check_ins row
    // is a different check-in, and the cockpit's check-out targets that id (#35).
    if (!other || other.arrived !== arrival.arrived || other.at !== arrival.at || other.id !== arrival.id) {
      return false;
    }
  }
  return true;
}

/**
 * Active check-in arrivals per guest — actual present koppen + partial-arrival
 * display (S13). RLS gates check_ins reads (admin/finance/doorhost/organizer); a
 * role without access gets an empty map and the cockpit falls back to the full
 * registered party for headcounts.
 */
export function usePoCheckinArrivals(eventId: string, options?: { refetchInterval?: number }) {
  return useQuery<Map<string, CheckinArrival>>({
    queryKey: poKeys.arrivals(eventId),
    enabled: !!eventId,
    staleTime: 10_000,
    refetchInterval: options?.refetchInterval,
    queryFn: () => fetchCheckinArrivals(createClient(), eventId),
    structuralSharing: (oldData, newData) => {
      const old = oldData as Map<string, CheckinArrival> | undefined;
      const next = newData as Map<string, CheckinArrival>;
      return old && arrivalsEqual(old, next) ? old : next;
    },
  });
}

// Door rush = several check-ins/sec from 5+ devices; each check-in touches BOTH
// `guests` (status flip) and `check_ins` (insert), i.e. 2 postgres_changes events.
// Firing the full cascade per event made the cockpit re-download an unchanged
// list on every single check-in (~20 requests/check-in, 86ey9e8fe).
// Leading+trailing coalesce: the first event in a quiet period still invalidates
// immediately (a lone check-in feels instant), further events within the window
// are absorbed into one trailing refetch instead of firing again per event.
const REALTIME_INVALIDATE_THROTTLE_MS = 500;

/**
 * Keep the cockpit live: subscribe to this event's guests changes (the check-in
 * trigger flips guests.status) AND to check_ins (top-ups/voids touch check_ins
 * without a status move), invalidating the guest list + tier counts + arrivals +
 * stats. Mirrors the door's realtime setup (useDoorSync) — JWT set before
 * subscribe, the shared device-scoped client — but the cockpit needs no outbox, so
 * refetch-on-change is enough. Invalidation is throttled (see above) rather than
 * firing once per postgres_changes event. Returns the channel state for the "live"
 * indicator.
 */
export function usePoEventRealtime(eventId: string): { realtimeConnected: boolean } {
  const qc = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    const client = getDoorClient();
    let cancelled = false;
    let channel: ReturnType<typeof client.channel> | null = null;
    // Previous channel status → refetch on resubscribe after a drop (#0b).
    let prevStatus: ChannelStatus | null = null;
    let throttleTimer: ReturnType<typeof setTimeout> | null = null;
    let trailingPending = false;

    void client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const token = data.session?.access_token;
      if (token) client.realtime.setAuth(token);

      const runInvalidate = (): void => {
        void qc.invalidateQueries({ queryKey: poKeys.guests(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.tiers(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.arrivals(eventId) });
        void qc.invalidateQueries({ queryKey: poKeys.eventStats(eventId) });
        // A peer's check-in/void also touches the event-detail header (headcount).
        // NOT the venue-wide All-Guests tab (86ey9e8hz): re-downloading that
        // working set on every check-in during a rush is exactly the cost the
        // windowing removed — it refreshes on guest writes (mutation paths keep
        // invalidating VENUE_GUESTS_PREFIX), on navigation, and on its safety sync.
        void qc.invalidateQueries({ queryKey: poKeys.eventDetail(eventId) });
      };

      // Leading edge fires now; further calls inside the window only flag a
      // trailing refetch so a whole burst collapses into at most 2 cascades.
      const invalidate = (): void => {
        if (throttleTimer) {
          trailingPending = true;
          return;
        }
        runInvalidate();
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          if (trailingPending) {
            trailingPending = false;
            runInvalidate();
          }
        }, REALTIME_INVALIDATE_THROTTLE_MS);
      };

      channel = client
        .channel(`eventday:${eventId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'guests', filter: `event_id=eq.${eventId}` },
          invalidate
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'check_ins', filter: `event_id=eq.${eventId}` },
          invalidate
        )
        .subscribe((st) => {
          if (cancelled) return;
          // Heal a missed burst: a resubscribe after a drop replays nothing, so
          // refetch the 4 cockpit queries to close the gap (#0b).
          if (shouldRefetchOnStatus(prevStatus, st)) invalidate();
          prevStatus = st;
          setRealtimeConnected(st === 'SUBSCRIBED');
        });
    });

    return () => {
      cancelled = true;
      setRealtimeConnected(false);
      if (throttleTimer) clearTimeout(throttleTimer);
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
// Read VENUE-WIDE (one venue_id, SCALE-5 — was an `.in(eventIds)` list sourced
// from usePoEvents, which both 414s past ~205 events AND forced a second
// venue-wide query to resolve before this one could even fire), so the inbox
// can show "Alle events" + an event picker. RLS still gates the requests
// themselves: a role without rights gets [], so the screen shows an empty tab
// rather than an error. The mutation hooks invalidate the [...all,'requests'] /
// [...all,'quota-requests'] prefix, which matches these venue keys, so a
// decided request drops off on success.

/** Pending landing-page guest requests across the active venue's events. */
export function usePoGuestRequests() {
  const { venueId } = usePoIdentity();
  return useQuery<PoGuestRequest[]>({
    queryKey: poKeys.requests(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      const rows = await fetchGuestRequests(createClient(), venueId ?? '');
      return rows.map((r) => toPoGuestRequest(r));
    },
  });
}

/** Pending quota requests across the active venue's events. */
export function usePoQuotaRequests() {
  const { venueId } = usePoIdentity();
  return useQuery<PoQuotaRequest[]>({
    queryKey: poKeys.quotaRequests(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      const rows = await fetchQuotaRequests(createClient(), venueId ?? '');
      return rows.map((r) => toPoQuotaRequest(r));
    },
  });
}

// ── Request links + influencers (Requests-epic F1, 86ey21vjt) ──
// Links scope to one event (the Request-links screen + the EventEdit row count);
// the lean venue-wide list feeds the approvals link filter; influencers scope to
// the active venue. RLS gates every read — a role without rights gets [].

/** One event's request links with their funnel numbers (default link pinned first). */
export function usePoRequestLinks(eventId: string) {
  return useQuery<PoRequestLink[]>({
    queryKey: poKeys.requestLinks(eventId),
    enabled: !!eventId,
    queryFn: () => fetchRequestLinks(createClient(), eventId),
  });
}

/** Every non-archived link across the active venue's events (lean, for filters). */
export function usePoVenueLinks() {
  const { venueId } = usePoIdentity();
  return useQuery<PoLinkOption[]>({
    queryKey: poKeys.venueLinks(venueId ?? ''),
    enabled: !!venueId,
    queryFn: () => fetchVenueRequestLinks(createClient(), venueId ?? ''),
  });
}

/** The active venue's influencer roster (non-archived), with link counts. */
export function usePoInfluencers() {
  const { venueId } = usePoIdentity();
  return useQuery<PoInfluencer[]>({
    queryKey: poKeys.influencers(venueId ?? ''),
    enabled: !!venueId,
    queryFn: () => (venueId ? fetchVenueInfluencers(createClient(), venueId) : Promise.resolve([])),
  });
}

// ── Promotion dashboard (Requests-epic F2, 86ey6b3fe — S15) ──
// The RPCs self-guard on role (admin/finance/organizer); everyone else gets [].

export type PromoRange = '30' | '90' | 'all';

/** now − N days as ISO, or null for the all-time window. Computed at fetch time
 *  (inside queryFn) so a cached key doesn't freeze the window edge. */
function promoRangeFrom(range: PromoRange): string | null {
  if (range === 'all') return null;
  const days = range === '30' ? 30 : 90;
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/** Every request link on one event with its full funnel (overview + section 2). */
export function usePoLinkFunnel(eventId: string) {
  return useQuery<PoLinkFunnelRow[]>({
    queryKey: poKeys.linkFunnel(eventId),
    enabled: !!eventId,
    queryFn: () => fetchEventLinkFunnel(createClient(), eventId),
  });
}

/** The venue-wide influencer leaderboard for a range (checked-in desc). */
export function usePoPromoLeaderboard(range: PromoRange) {
  const { venueId } = usePoIdentity();
  return useQuery<PoLeaderboardRow[]>({
    queryKey: poKeys.promoLeaderboard(venueId ?? '', range),
    enabled: !!venueId,
    queryFn: () =>
      venueId
        ? fetchInfluencerLeaderboard(createClient(), venueId, promoRangeFrom(range))
        : Promise.resolve([]),
  });
}

/** Label-only (unattributed) links across the venue for a range. */
export function usePoPromoLabelFunnel(range: PromoRange) {
  const { venueId } = usePoIdentity();
  return useQuery<PoLabelFunnelRow[]>({
    queryKey: poKeys.promoLabelFunnel(venueId ?? '', range),
    enabled: !!venueId,
    queryFn: () =>
      venueId
        ? fetchVenueLabelFunnel(createClient(), venueId, promoRangeFrom(range))
        : Promise.resolve([]),
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

/** Permanent contacts only (the Guests tab's "Regulars" filter) — derived from the unsearched list. */
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

/**
 * The unified person profile, resolved from a contact id OR a guest id (header +
 * cross-event appearances + a derived activity timeline). Tapping a guest opens the
 * same screen: linked → the full contact profile; name-only → a single-appearance
 * profile (isContact false) the caller can promote. Derived-only (no audit/AAL2):
 * RLS scopes the underlying reads, so an admin sees the whole history and an
 * organizer only their events'. `originEventId` pins the event you came from to the
 * top. Returns null when nothing is visible — the screen shows its not-found state.
 */
export function usePoPersonProfile(args: {
  contactId?: string | null;
  guestId?: string | null;
  originEventId?: string | null;
}) {
  const { contactId, guestId, originEventId } = args;
  // One cache key per person, under the ['po','contact-profile'] prefix so a
  // contact write (edit / promote / add-to-event) refreshes whichever is open.
  const key = contactId ?? (guestId ? `g:${guestId}` : '');
  return useQuery<PoContactProfile | null>({
    queryKey: poKeys.contactProfile(key),
    enabled: !!key,
    queryFn: async () => {
      const data = await fetchPersonProfile(createClient(), { contactId, guestId });
      if (!data.header) return null;
      return toPoContactProfile(data.header, data.appearances, data.actorNames, {
        isContact: data.isContact,
        promoteGuestId: data.promoteGuestId,
        restricted: data.restricted,
        originEventId,
      });
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

export interface PoAllowanceMember extends PoTeamMember {
  /** This event's override (event_quotas.quota_override); equals `quota` (the
   *  venue-default base) when no override is set for this event. */
  override: number;
}

/** Every team member's default quota + this event's override, for the Allowance
 *  screen (per-event quota, event_quotas). Mirrors usePoTeam plus one more read. */
export function usePoEventAllowance(eventId: string | null) {
  const { venueId } = usePoIdentity();
  return useQuery<PoAllowanceMember[]>({
    queryKey: poKeys.allowance(eventId ?? ''),
    enabled: !!venueId && !!eventId,
    queryFn: async () => {
      if (!venueId || !eventId) return [];
      const client = createClient();
      const [members, quotas, settings, overrides] = await Promise.all([
        fetchVenueMembers(client, venueId),
        fetchMemberQuotas(client, venueId),
        fetchVenueSettings(client, venueId),
        fetchEventQuotaOverrides(client, eventId),
      ]);
      const quotaByUser = new Map(quotas.map((q) => [q.user_id, q.default_count]));
      const overrideByUser = new Map(overrides.map((o) => [o.user_id, o.quota_override]));
      const venueDefault = settings?.default_personal_quota ?? 0;
      return members.map((m) => {
        const base = quotaByUser.get(m.user_id) ?? venueDefault;
        return { ...toPoTeamMember(m, base), override: overrideByUser.get(m.user_id) ?? base };
      });
    },
  });
}

/** The venue's invitations — pending, expired AND accepted, so the Team screen
 *  shows an accepted-status per invite (T8). */
export function usePoInvites() {
  const { venueId } = usePoIdentity();
  return useQuery<PoInvite[]>({
    queryKey: poKeys.invites(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const rows = await fetchVenueInvites(createClient(), venueId);
      return rows.map((r) => toPoInvite(r));
    },
  });
}

/** Venue-wide external crew (event-scoped organizers, deduped, members
 *  excluded) — the Team screen's second section (T8). */
export function usePoVenueCrew() {
  const { venueId } = usePoIdentity();
  return useQuery<PoVenueCrewMember[]>({
    queryKey: poKeys.venueCrew(venueId ?? ''),
    enabled: !!venueId,
    queryFn: async () => {
      if (!venueId) return [];
      const rows = await fetchVenueCrew(createClient(), venueId);
      return rows.map(toPoVenueCrewMember);
    },
  });
}

/** Invites addressed to the signed-in user — drives the incoming "accepteer
 *  uitnodiging" banner (the mid-session case the desktop banner covered). */
export function usePoMyPendingInvites() {
  return useQuery<PoMyInvite[]>({
    queryKey: poKeys.myInvites(),
    queryFn: async () => {
      const rows = await fetchMyPendingInvites(createClient());
      return rows.map(toPoMyInvite);
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

/**
 * Soft-block state of the active venue (#32 refinement, fase 13 PR 3): true
 * when growth actions (new events, invites, import) are blocked — canceled, or
 * a lapsed trial that never completed checkout. UX-layer mirror of the server
 * gate (assertVenueBillingActive): the screens lock the affordances, the
 * server actions enforce. Loading/absent subscription reads as NOT blocked —
 * the server gate has the final word.
 */
export function useBillingBlocked(): { blocked: boolean; reason: 'canceled' | 'trial_expired' | null } {
  const { data: sub } = usePoSubscription();
  if (!sub) return { blocked: false, reason: null };
  if (sub.status === 'canceled') return { blocked: true, reason: 'canceled' };
  if (
    sub.status === 'trialing' &&
    !sub.stripeLinked &&
    sub.trialEndsAt &&
    new Date(sub.trialEndsAt).getTime() < Date.now()
  ) {
    return { blocked: true, reason: 'trial_expired' };
  }
  return { blocked: false, reason: null };
}

// ── Audit log (S10) reads ────────────────────────────────────────────────────

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
