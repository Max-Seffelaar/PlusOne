import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { EventSummary, TierStat } from '@/features/stats/data';
import { describeAuditEntry, type AuditLine } from '@/features/audit/translate';
import { resolveAllowUncheck } from '@/features/events/allow-uncheck';
import { chunkIds, fetchAllRanged } from '@/lib/supabase/paging';

// Client-agnostic po reads (mirrors src/features/stats/data.ts): every function
// takes the caller's Supabase client, so a Server Component can prefetch with the
// request-scoped server client and a Client Component can read with the browser
// client. This module NEVER creates a client, so the server client can't leak
// into the client bundle. RLS is the boundary — an out-of-scope id yields [].
type Client = SupabaseClient<Database>;
type Tables = Database['public']['Tables'];
type GuestRowStatus = Database['public']['Enums']['guest_status'];

// "On the list" headcount = guests that occupy a slot (approved or already in);
// pending (awaiting approval) and denied/removed/refused don't count. Mirrors the
// confirmed-list notion the Events cards show. (#5 quota math: 1 + plus_ones.)
const ON_LIST: GuestRowStatus[] = ['approved', 'checked_in'];

export type PoEventRow = {
  id: string;
  name: string;
  starts_at: string;
  ends_at: string | null;
  status: Database['public']['Enums']['event_status'];
  cancelled_at: string | null;
  list_locked: boolean;
  venue_name: string;
};

export type PoGuestRow = Pick<
  Tables['guests']['Row'],
  'id' | 'full_name' | 'plus_ones' | 'status' | 'tier_id' | 'note' | 'note_priority' | 'created_at' | 'contact_id'
>;

export type PoTierRow = Pick<
  Tables['guest_tiers']['Row'],
  'id' | 'name' | 'color' | 'max_guests' | 'aliases' | 'door_price_cents'
>;

/** All events for a venue, newest first (RLS: members read their venue's events). */
export async function fetchEvents(client: Client, venueId: string): Promise<PoEventRow[]> {
  const { data } = await client
    .from('events')
    .select('id, name, starts_at, ends_at, status, cancelled_at, list_locked, venues(name)')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false });

  return (data ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    status: e.status,
    cancelled_at: e.cancelled_at,
    list_locked: e.list_locked,
    venue_name: e.venues?.name ?? '',
  }));
}

/**
 * Active guests for an event (soft-deleted excluded), oldest first.
 *
 * This is the po surface's canonical guest read, lifted out of the desktop
 * `(app)/events/[eventId]/guests/page.tsx` inline select so both the desktop
 * Server Component and the mobile Client Components share one query shape
 * (STAP 3.4). Both run through the USER-scoped client, so RLS stays the
 * boundary — staff see only their own guests, an out-of-scope id yields [].
 * The desktop page keeps its own richer select (email/phone/source for the
 * edit form, removed rows shown struck-through); this lean projection is
 * exactly what `toPoGuest` needs.
 */
export async function fetchPoGuests(client: Client, eventId: string): Promise<PoGuestRow[]> {
  // Ranged: a 1500-guest list would truncate at PostgREST's 1000-row cap, hiding
  // the rest. `created_at` isn't unique, so `.order('id')` is the tiebreaker that
  // makes the page order deterministic (no overlap/skip across `.range()` windows).
  return fetchAllRanged<PoGuestRow>((from, to) =>
    client
      .from('guests')
      .select('id, full_name, plus_ones, status, tier_id, note, note_priority, created_at, contact_id')
      .eq('event_id', eventId)
      .neq('status', 'removed')
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  );
}

export interface PoQuotaStatus {
  /** Personal slot allowance for this event; -1 when exempt (admin/organizer). */
  quota: number;
  /** Slots already consumed by the caller (1 + plus-ones each). */
  consumed: number;
  /** Slots left, or null when exempt. */
  remaining: number | null;
  /** Admin/organizer: no personal limit. */
  exempt: boolean;
}

/**
 * The caller's personal quota for an event (#22/#31), via the same
 * `event_quota_status` RPC the desktop guests page uses. Drives the quick-add
 * "X van N over" hint and the pre-submit overage block. The DB is still the
 * real enforcement boundary — this is early UI feedback only.
 */
export async function fetchEventQuota(
  client: Client,
  eventId: string
): Promise<PoQuotaStatus | null> {
  const { data } = await client
    .rpc('event_quota_status', { p_event_id: eventId })
    .maybeSingle();
  if (!data) return null;
  return {
    quota: data.quota,
    consumed: data.consumed,
    remaining: data.exempt ? null : data.remaining,
    exempt: data.exempt,
  };
}

/** Tiers for an event (RLS: members read their venue's tiers). */
export async function fetchTiers(client: Client, eventId: string): Promise<PoTierRow[]> {
  const { data } = await client
    .from('guest_tiers')
    .select('id, name, color, max_guests, aliases, door_price_cents')
    .eq('event_id', eventId)
    .order('name', { ascending: true });

  return data ?? [];
}

export interface EventHeadcount {
  /** On-list headcount (1 + plus-ones over approved/checked-in guests). */
  registered: number;
  /** Present headcount (1 + plus-ones over checked-in guests). */
  present: number;
}

/**
 * Registered + present headcounts for many events in ONE query — the Events /
 * EventBeheer cards show these without an RPC per row. Aggregated client-side
 * from the guests rows RLS already lets the caller read.
 */
export async function fetchEventHeadcounts(
  client: Client,
  eventIds: string[]
): Promise<Map<string, EventHeadcount>> {
  const counts = new Map<string, EventHeadcount>();
  if (eventIds.length === 0) return counts;

  // Ranged: this sums guests across MANY events, so the combined row set can pass
  // 1000 even when each event is small. No natural order here → `.order('id')` is
  // both the sort and the unique tiebreaker the ranged paging needs.
  const data = await fetchAllRanged<Pick<Tables['guests']['Row'], 'event_id' | 'plus_ones' | 'status'>>(
    (from, to) =>
      client
        .from('guests')
        .select('event_id, plus_ones, status')
        .in('event_id', eventIds)
        .in('status', ON_LIST)
        .order('id')
        .range(from, to),
  );

  for (const g of data) {
    const cur = counts.get(g.event_id) ?? { registered: 0, present: 0 };
    const heads = 1 + g.plus_ones;
    cur.registered += heads;
    if (g.status === 'checked_in') cur.present += heads;
    counts.set(g.event_id, cur);
  }
  return counts;
}

export interface RecentCheckinRow {
  guestId: string;
  name: string;
  /** Plus-ones that actually arrived on this check-in. */
  plus: number;
  /** Check-in instant (ISO) for display. */
  at: string;
  /** Display name of who let them in (check_ins.checked_by → profile). */
  by: string;
}

/** Most recent (non-voided) check-ins for an event — drives "Laatst binnen". */
export async function fetchRecentCheckins(
  client: Client,
  eventId: string,
  limit = 3
): Promise<RecentCheckinRow[]> {
  const { data } = await client
    .from('check_ins')
    .select('checked_at, plus_ones_arrived, checked_by, guests!inner(id, full_name, event_id)')
    .eq('guests.event_id', eventId)
    .is('voided_at', null)
    .order('checked_at', { ascending: false })
    .limit(limit);

  const rows = data ?? [];
  // Resolve the checker names in one round-trip (RLS: door roles read profiles).
  const ids = [...new Set(rows.map((r) => r.checked_by))];
  const profiles = ids.length
    ? (await client.from('user_profiles').select('id, full_name').in('id', ids)).data ?? []
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    guestId: r.guests.id,
    name: r.guests.full_name,
    plus: r.plus_ones_arrived,
    at: r.checked_at,
    by: nameById.get(r.checked_by) ?? 'Deur',
  }));
}

/** Count of open (pending) guest requests for an event — the "Aandacht nodig" nudge. */
export async function fetchOpenRequestCount(client: Client, eventId: string): Promise<number> {
  const { count } = await client
    .from('guest_requests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'pending');

  return count ?? 0;
}

// ── Approvals reads (S5 Aanvragen, STAP 3.6) ──────────────────────────────────
// Pending landing-page guest requests (#12/#31) + pending quota requests (#5),
// read VENUE-WIDE across a set of event ids so the inbox can show "Alle events"
// + an event picker. The caller passes the venue's visible event ids (from
// usePoEvents, already RLS-scoped); RLS stays the boundary on the requests
// themselves — admin sees every event's, an organizer only their own events'.
// Each row carries its event_id so the screen can group/filter and target the
// right event's tiers on approval. An empty id list short-circuits to [].

export type PoGuestRequestRow = Pick<
  Tables['guest_requests']['Row'],
  'id' | 'full_name' | 'phone' | 'plus_ones' | 'motivation' | 'created_at' | 'event_id' | 'status' | 'decision_reason'
>;

/**
 * Landing-page requests across the given events — both still-open (pending) and
 * already-DENIED, oldest first. The screen shows the open ones as the queue and
 * the denied ones in an "Afgewezen" section, where an admin can still add the
 * person after all (re-approve, #12). Approved requests are excluded (they're on
 * the list already). RLS limits visibility to admin/finance/organizer.
 */
export async function fetchGuestRequests(
  client: Client,
  eventIds: string[]
): Promise<PoGuestRequestRow[]> {
  if (eventIds.length === 0) return [];
  const { data } = await client
    .from('guest_requests')
    .select('id, full_name, phone, plus_ones, motivation, created_at, event_id, status, decision_reason')
    .in('event_id', eventIds)
    .in('status', ['pending', 'denied'])
    .order('created_at', { ascending: true });

  return data ?? [];
}

export interface PoQuotaRequestRow {
  id: string;
  eventId: string;
  requestedExtra: number;
  motivation: string | null;
  created_at: string;
  /** Resolved requester display name (RLS-scoped user_profiles join). */
  requesterName: string;
}

/**
 * Pending quota requests across the given events, oldest first, with the
 * requester name resolved in a second round-trip — mirrors the desktop guests
 * page exactly so both surfaces stay RLS-safe (no FK-embed guessing; an
 * unreadable profile just falls back to "Onbekend").
 */
export async function fetchQuotaRequests(
  client: Client,
  eventIds: string[]
): Promise<PoQuotaRequestRow[]> {
  if (eventIds.length === 0) return [];
  const { data: reqs } = await client
    .from('quota_requests')
    .select('id, event_id, requested_extra, motivation, created_at, user_id')
    .in('event_id', eventIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });

  const rows = reqs ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profiles = ids.length
    ? (await client.from('user_profiles').select('id, full_name').in('id', ids)).data ?? []
    : [];
  const nameById = new Map(profiles.map((p) => [p.id, p.full_name]));

  return rows.map((r) => ({
    id: r.id,
    eventId: r.event_id,
    requestedExtra: r.requested_extra,
    motivation: r.motivation,
    created_at: r.created_at,
    requesterName: nameById.get(r.user_id) ?? 'Unknown',
  }));
}

export interface RecapGuestRow {
  id: string;
  full_name: string;
  plus_ones: number;
  status: GuestRowStatus;
  tierName: string | null;
  addedByName: string | null;
  /** Latest non-voided check-in instant (ISO), or null when never arrived. */
  checkedAt: string | null;
}

// The recap guest projection (with its FK embeds). The generated client types
// each embed as to-one OR to-many, so the embedded relations stay deliberately
// loose here and the mapper below normalizes them ([x].flat()).
type RecapGuestRaw = {
  id: string;
  full_name: string;
  plus_ones: number;
  status: GuestRowStatus;
  guest_tiers: { name: string } | { name: string }[] | null;
  added_by_profile: { full_name: string } | { full_name: string }[] | null;
  check_ins: { checked_at: string; voided_at: string | null }[] | { checked_at: string; voided_at: string | null } | null;
};

/**
 * Guests of a (past) event with their tier, who-added, and check-in time — the
 * source for the recap's "ingecheckt" and "niet verschenen" lists. Only on-list
 * statuses; the per-guest check-in time is the latest non-voided check_in. Ranged
 * (`.order('id')` keys the paging) so a 1500-guest recap loads every row.
 */
export async function fetchRecapGuests(client: Client, eventId: string): Promise<RecapGuestRow[]> {
  const data = await fetchAllRanged<RecapGuestRaw>((from, to) =>
    client
      .from('guests')
      .select(
        'id, full_name, plus_ones, status, guest_tiers(name), added_by_profile:user_profiles!guests_added_by_fkey(full_name), check_ins(checked_at, voided_at)'
      )
      .eq('event_id', eventId)
      .in('status', ON_LIST)
      .order('id')
      .range(from, to),
  );

  return data.map((g) => {
    // The generated client can type the embed as to-one OR to-many; normalize to
    // an array (and drop any nullish) before reading the latest non-voided time.
    const checkins = [g.check_ins].flat().filter(Boolean) as Array<{
      checked_at: string;
      voided_at: string | null;
    }>;
    const checkedAt = checkins
      .filter((c) => c.voided_at == null)
      .map((c) => c.checked_at)
      .sort()
      .at(-1);
    const tier = [g.guest_tiers].flat().filter(Boolean)[0] as { name: string } | undefined;
    const addedBy = [g.added_by_profile].flat().filter(Boolean)[0] as { full_name: string } | undefined;
    return {
      id: g.id,
      full_name: g.full_name,
      plus_ones: g.plus_ones,
      status: g.status,
      tierName: tier?.name ?? null,
      addedByName: addedBy?.full_name ?? null,
      checkedAt: checkedAt ?? null,
    };
  });
}

export interface PastEventStats {
  summary: EventSummary | null;
  tiers: TierStat[];
}

/** The two analytics RPCs the past-event recap needs (refused + peak + per-tier). */
export async function fetchPastEventStats(
  client: Client,
  eventId: string
): Promise<PastEventStats> {
  const [summary, tiers] = await Promise.all([
    client.rpc('event_stats_summary', { p_event_id: eventId }).maybeSingle(),
    client.rpc('event_tier_stats', { p_event_id: eventId }),
  ]);
  return { summary: summary.data ?? null, tiers: tiers.data ?? [] };
}

export interface EventEditRow {
  id: string;
  name: string;
  startsAt: string;
  endsAt: string | null;
  status: Database['public']['Enums']['event_status'];
  /** When set, the event is cancelled (admin-only writes, no door, no requests). */
  cancelledAt: string | null;
  landingActive: boolean;
  landingSlug: string;
  listLocked: boolean;
  autoLockAt: string | null;
  venueName: string;
  /** The caller is an organizer scoped to this event (admin is derived from roles). */
  isOrganizer: boolean;
  /** Effective "uitchecken toestaan" (event override -> venue default -> true, #3 / S1.1). */
  allowUncheck: boolean;
  /** Raw per-event override: null = inherit the venue default. Drives the toggle's "volg standaard" state. */
  allowUncheckOverride: boolean | null;
  /** The venue/company default, so the form can label what "volg standaard" resolves to. */
  venueAllowUncheck: boolean;
}

/** A single event with the editable fields + the caller's organizer scope (EventEdit). */
export async function fetchEventForEdit(
  client: Client,
  eventId: string,
  userId: string
): Promise<EventEditRow | null> {
  const [{ data: e }, { data: org }] = await Promise.all([
    client
      .from('events')
      .select(
        'id, name, starts_at, ends_at, status, cancelled_at, landing_active, landing_slug, list_locked, auto_lock_at, allow_uncheck, venues(name, allow_uncheck)'
      )
      .eq('id', eventId)
      .maybeSingle(),
    client
      .from('event_organizers')
      .select('user_id')
      .eq('event_id', eventId)
      .eq('user_id', userId)
      .maybeSingle(),
  ]);
  if (!e) return null;

  const venueAllowUncheck = e.venues?.allow_uncheck ?? true;
  return {
    id: e.id,
    name: e.name,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    status: e.status,
    cancelledAt: e.cancelled_at,
    landingActive: e.landing_active,
    landingSlug: e.landing_slug,
    listLocked: e.list_locked,
    autoLockAt: e.auto_lock_at,
    venueName: e.venues?.name ?? '',
    isOrganizer: !!org,
    allowUncheck: resolveAllowUncheck(e.allow_uncheck, venueAllowUncheck),
    allowUncheckOverride: e.allow_uncheck,
    venueAllowUncheck,
  };
}

export interface CheckinArrival {
  /** plus_ones_arrived on the active check-in (actual companions present). */
  arrived: number;
  /** ISO check-in time, for "Binnen · HH:MM". */
  at: string;
}

type CheckinArrivalRow = Pick<
  Tables['check_ins']['Row'],
  'guest_id' | 'plus_ones_arrived' | 'checked_at' | 'voided_at'
>;

/**
 * Active (non-voided) check-in arrivals for an event's guests, keyed by guest id.
 * The cockpit (S13) uses this for the ACTUAL present headcount and partial-arrival
 * display (a +3 guest with 1 companion present = 2 koppen binnen, not 4). check_ins
 * carries no event_id, so we filter via an inner-join on the guest's event
 * (mirrors fetchDoorSnapshot/fetchRecentCheckins) — no `.in('guest_id', …)` list
 * that would blow Kong's URI length at 1500 ids. Ranged so >1000 check-ins all
 * load; `.order('id')` gives the deterministic order paging requires. RLS still
 * gates which check_ins are visible.
 */
export async function fetchCheckinArrivals(
  client: Client,
  eventId: string
): Promise<Map<string, CheckinArrival>> {
  const rows = await fetchAllRanged<CheckinArrivalRow & { guests: unknown }>((from, to) =>
    client
      .from('check_ins')
      .select('guest_id, plus_ones_arrived, checked_at, voided_at, guests!inner(event_id)')
      .eq('guests.event_id', eventId)
      .order('id')
      .range(from, to),
  );

  const map = new Map<string, CheckinArrival>();
  for (const row of rows) {
    if (row.voided_at == null) map.set(row.guest_id, { arrived: row.plus_ones_arrived, at: row.checked_at });
  }
  return map;
}

export type TierWithUsage = PoTierRow & { used: number };

/**
 * Tiers of an event with current occupancy — mirrors getEventTiers: "used" counts
 * entries that aren't removed/denied (matches guest_tier_contribution), as people
 * (not headcount), for the tier-max bar.
 */
export async function fetchTiersWithUsage(
  client: Client,
  eventId: string
): Promise<TierWithUsage[]> {
  const [{ data: tiers }, guests] = await Promise.all([
    client.from('guest_tiers').select('id, name, color, max_guests, aliases, door_price_cents').eq('event_id', eventId).order('name'),
    // Ranged: occupancy counts every non-removed/denied guest, so a 1500-guest
    // event would otherwise truncate the count at 1000. `.order('id')` keys the paging.
    fetchAllRanged<Pick<Tables['guests']['Row'], 'tier_id' | 'status'>>((from, to) =>
      client.from('guests').select('tier_id, status').eq('event_id', eventId).order('id').range(from, to),
    ),
  ]);

  const used = new Map<string, number>();
  for (const g of guests) {
    if (g.status === 'removed' || g.status === 'denied') continue;
    used.set(g.tier_id, (used.get(g.tier_id) ?? 0) + 1);
  }

  return (tiers ?? []).map((t) => ({ ...t, used: used.get(t.id) ?? 0 }));
}

// ── External crew (event_organizers, #6/#24) ─────────────────────────────────
// People scoped to ONE event (a DJ, artist, guest organizer) — surfaced as
// "External crew", distinct from venue-wide Team. Reads mirror the server
// getEventOrganizers/getAssignableMembers; RLS limits visibility (members of the
// event's venue, or the organizer themself) and writes (admin) — these only shape
// rows for the UI. Client-agnostic like the rest of this module.

export interface PoCrewMember {
  userId: string;
  fullName: string;
  email: string;
  /** Per-event guest quota (event_quotas.quota_override); 0 = none set. */
  quota: number;
}

/** Crew (event_organizers) on an event, with each member's guest quota, name-sorted. */
export async function fetchEventCrew(client: Client, eventId: string): Promise<PoCrewMember[]> {
  const [{ data: crew }, { data: quotas }] = await Promise.all([
    client.from('event_organizers').select('user_id, user_profiles(full_name, email)').eq('event_id', eventId),
    // event_quotas RLS: admin/finance read all for the venue's events (a member
    // reads only their own row) — a non-admin viewer just sees 0 here, which is fine.
    client.from('event_quotas').select('user_id, quota_override').eq('event_id', eventId),
  ]);

  const quotaByUser = new Map((quotas ?? []).map((q) => [q.user_id, q.quota_override]));
  return (crew ?? [])
    .map((row) => ({
      userId: row.user_id,
      fullName: row.user_profiles?.full_name ?? '—',
      email: row.user_profiles?.email ?? '—',
      quota: quotaByUser.get(row.user_id) ?? 0,
    }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
}

/**
 * The pool for "add a returning external crew member": people who are external
 * crew on ANY event at this event's venue, EXCLUDING venue Team members (they
 * already work every event) and anyone already on THIS event. Resolves the event's
 * venue first (so it works even when that venue isn't the caller's active one).
 * RLS still decides what's actually visible. (Search is applied client-side.)
 */
export async function fetchAssignableCrew(client: Client, eventId: string): Promise<PoCrewMember[]> {
  const { data: ev } = await client.from('events').select('venue_id').eq('id', eventId).maybeSingle();
  if (!ev) return [];
  const venueId = ev.venue_id;

  const [{ data: orgRows }, { data: members }, { data: current }] = await Promise.all([
    client
      .from('event_organizers')
      .select('user_id, user_profiles(full_name, email), events!inner(venue_id)')
      .eq('events.venue_id', venueId),
    client.from('venue_memberships').select('user_id').eq('venue_id', venueId),
    client.from('event_organizers').select('user_id').eq('event_id', eventId),
  ]);

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const currentIds = new Set((current ?? []).map((c) => c.user_id));
  const seen = new Set<string>();
  const pool: PoCrewMember[] = [];
  for (const r of orgRows ?? []) {
    if (memberIds.has(r.user_id) || currentIds.has(r.user_id) || seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    pool.push({
      userId: r.user_id,
      fullName: r.user_profiles?.full_name ?? '—',
      email: r.user_profiles?.email ?? '—',
      quota: 0,
    });
  }
  return pool.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// ── Event templates (86exyp8gn) ──────────────────────────────────────────────
// Reusable per-event-type setups (RLS: members read their venue's templates).
export type PoTemplateRow = Pick<
  Tables['event_templates']['Row'],
  'id' | 'name' | 'capacity' | 'allow_uncheck' | 'landing_active' | 'auto_lock_offset_minutes'
> & { tierCount: number };

export type PoTemplateDetail = Pick<
  Tables['event_templates']['Row'],
  'id' | 'venue_id' | 'name' | 'capacity' | 'allow_uncheck' | 'landing_active' | 'auto_lock_offset_minutes'
>;

export type PoTemplateTierRow = Pick<
  Tables['event_template_tiers']['Row'],
  'id' | 'name' | 'description' | 'color' | 'max_guests' | 'aliases' | 'position'
>;

/** Every template of a venue with its tier count, name-sorted. */
export async function fetchTemplates(client: Client, venueId: string): Promise<PoTemplateRow[]> {
  const { data } = await client
    .from('event_templates')
    .select(
      'id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes, event_template_tiers(count)',
    )
    .eq('venue_id', venueId)
    .order('name');
  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    capacity: t.capacity,
    allow_uncheck: t.allow_uncheck,
    landing_active: t.landing_active,
    auto_lock_offset_minutes: t.auto_lock_offset_minutes,
    tierCount: t.event_template_tiers?.[0]?.count ?? 0,
  }));
}

/** A single template's editable fields. */
export async function fetchTemplate(client: Client, templateId: string): Promise<PoTemplateDetail | null> {
  const { data } = await client
    .from('event_templates')
    .select('id, venue_id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes')
    .eq('id', templateId)
    .maybeSingle();
  return data ?? null;
}

/** A template's tiers in seeding order (position, then creation). */
export async function fetchTemplateTiers(client: Client, templateId: string): Promise<PoTemplateTierRow[]> {
  const { data } = await client
    .from('event_template_tiers')
    .select('id, name, description, color, max_guests, aliases, position')
    .eq('template_id', templateId)
    .order('position')
    .order('created_at');
  return data ?? [];
}

/**
 * Whether the caller organizes ANY event at this venue — the client-side half of
 * the "admin OR organizer" template-management gate (organizes_event_at_venue in
 * RLS). The user can read their own event_organizers rows (user_id = auth.uid()),
 * so this counts them, inner-joined to the venue's events. RLS stays the real
 * boundary; this only decides which write affordances the UI shows.
 */
export async function fetchOrganizesAtVenue(client: Client, venueId: string, userId: string): Promise<boolean> {
  if (!userId || !venueId) return false;
  const { count } = await client
    .from('event_organizers')
    .select('event_id, events!inner(venue_id)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('events.venue_id', venueId);
  return (count ?? 0) > 0;
}

// ── Address book reads (S3 Adresboek + Import) ──
// Direct contacts-table reads, so RLS (20260615130000) limits them to admin /
// finance / event-organizer — staff/doorhost get [] and the screen renders empty.
// Client-agnostic like the rest of this module.

export type PoContactRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  preferred_role: Database['public']['Enums']['contact_role'] | null;
  note: string | null;
  is_permanent: boolean;
  /** Distinct non-removed events this contact has appeared on ("X× op een lijst"). */
  eventCount: number;
};

/** Distinct-events-per-contact map, scoped by RLS to what the caller can read. */
async function contactEventCounts(client: Client, contactIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (contactIds.length === 0) return counts;

  // A venue can have >1000 contacts, so the `.in('contact_id', …)` filter is
  // chunked (≤1000 ids per request) to stay under Kong's URI length; each chunk's
  // guest rows can themselves exceed 1000, so every chunk is ranged. `.order('id')`
  // keys the paging.
  const seen = new Map<string, Set<string>>();
  for (const chunk of chunkIds(contactIds)) {
    const rows = await fetchAllRanged<Pick<Tables['guests']['Row'], 'contact_id' | 'event_id'>>((from, to) =>
      client
        .from('guests')
        .select('contact_id, event_id')
        .in('contact_id', chunk)
        .neq('status', 'removed')
        .order('id')
        .range(from, to),
    );
    for (const g of rows) {
      if (!g.contact_id) continue;
      const set = seen.get(g.contact_id) ?? new Set<string>();
      set.add(g.event_id);
      seen.set(g.contact_id, set);
    }
  }
  for (const [cid, set] of seen) counts.set(cid, set.size);
  return counts;
}

/** The contacts-table row this screen reads, before the eventCount is joined on. */
type ContactBaseRow = Omit<PoContactRow, 'eventCount'>;

/** The venue address book (managers), newest-name-first, with per-contact event counts. */
export async function fetchContacts(
  client: Client,
  venueId: string,
  search?: string
): Promise<PoContactRow[]> {
  const term = search?.trim();
  // Ranged: a venue address book can hold >1000 contacts. The full filter (incl.
  // the optional name search) is rebuilt per page since builders are one-shot;
  // `full_name` isn't unique, so `.order('id')` is the deterministic tiebreaker.
  const rows = await fetchAllRanged<ContactBaseRow>((from, to) => {
    let query = client
      .from('contacts')
      .select('id, full_name, email, phone, birthdate, preferred_role, note, is_permanent')
      .eq('venue_id', venueId)
      .is('anonymized_at', null)
      .order('full_name')
      .order('id');
    if (term) query = query.ilike('full_name', `%${term}%`);
    return query.range(from, to);
  });

  const counts = await contactEventCounts(client, rows.map((c) => c.id));
  return rows.map((c) => ({ ...c, eventCount: counts.get(c.id) ?? 0 }));
}

/** Minimal e-mail/phone projection for the import dedup preview ("BESTAAT AL"). */
export async function fetchContactKeyRows(
  client: Client,
  venueId: string
): Promise<{ email: string | null; phone: string | null }[]> {
  // Ranged: same >1000-contact concern. `email`/`phone` aren't unique or even
  // sortable-as-key, so this orders by `id` purely for deterministic paging.
  return fetchAllRanged<{ email: string | null; phone: string | null }>((from, to) =>
    client
      .from('contacts')
      .select('email, phone')
      .eq('venue_id', venueId)
      .is('anonymized_at', null)
      .order('id')
      .range(from, to),
  );
}

// ── Contact profile (address-book detail) ─────────────────────────────────────
// One person across ALL their guest appearances (guests.contact_id), for the
// contact-profile screen. Derived-only (no audit log): the timeline is built from
// guests / check_ins / refusals — tables every contact-reader (admin/finance/
// organizer) can at least partly read — so the profile needs no AAL2 and is
// naturally RLS-sliced (admin sees the full cross-event history, an organizer only
// their events'). The audit-backed "who edited a field" trail stays out by design.

export interface ContactProfileHeader {
  id: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  preferredRole: Database['public']['Enums']['contact_role'] | null;
  note: string | null;
  isPermanent: boolean;
  source: Database['public']['Enums']['contact_source'];
  createdAt: string;
}

export interface ContactCheckIn {
  checkedAt: string;
  checkedBy: string;
  /** plus_ones_arrived — companions present on this check-in. */
  arrived: number;
  voidedAt: string | null;
  voidedBy: string | null;
}

export interface ContactRefusal {
  refusedAt: string;
  refusedBy: string;
  reason: string;
}

export interface ContactAppearance {
  guestId: string;
  eventId: string;
  eventName: string;
  eventStartsAt: string;
  plusOnes: number;
  status: GuestRowStatus;
  tierName: string | null;
  tierColor: string | null;
  /** Per-event door note + priority (shown on the pinned event's task card). */
  note: string | null;
  notePriority: Database['public']['Enums']['note_priority'];
  addedBy: string;
  /** guests.created_at — when they were put on this event's list. */
  addedAt: string;
  checkIns: ContactCheckIn[];
  refusals: ContactRefusal[];
}

export interface ContactProfileData {
  /** null when the contact isn't visible to the caller (RLS) or doesn't exist. */
  header: ContactProfileHeader | null;
  appearances: ContactAppearance[];
  /** Resolved actor display names by user id (for the timeline). */
  actorNames: Record<string, string>;
}

/**
 * The unified person profile, resolved from EITHER an address-book contact OR a
 * single guest row. A name-only guest (no contact) still gets a profile (its one
 * appearance), so tapping any guest opens the same screen — `isContact` drives the
 * "Save as contact" promote affordance + hides contact-only actions.
 */
export interface PersonProfileData extends ContactProfileData {
  /** True once the person is a real address-book contact (has email/phone). */
  isContact: boolean;
  /** For a name-only guest: the guest row to edit to promote it; null otherwise. */
  promoteGuestId: string | null;
}

// The embeds come back typed as to-one OR to-many by the generated client (same as
// fetchRecapGuests), so they stay loose here and the mapper normalizes them.
type ProfileEmbedEvent = { name: string; starts_at: string };
type ProfileEmbedTier = { name: string; color: string | null };
type ProfileEmbedCheckIn = {
  checked_at: string;
  checked_by: string;
  plus_ones_arrived: number;
  voided_at: string | null;
  voided_by: string | null;
};
type ProfileEmbedRefusal = { refused_at: string; refused_by: string; reason: string };
type ProfileAppearanceRaw = {
  id: string;
  event_id: string;
  plus_ones: number;
  status: GuestRowStatus;
  created_at: string;
  added_by: string;
  note: string | null;
  note_priority: Database['public']['Enums']['note_priority'];
  events: ProfileEmbedEvent | ProfileEmbedEvent[] | null;
  guest_tiers: ProfileEmbedTier | ProfileEmbedTier[] | null;
  check_ins: ProfileEmbedCheckIn | ProfileEmbedCheckIn[] | null;
  refusals: ProfileEmbedRefusal | ProfileEmbedRefusal[] | null;
};

const PROFILE_APPEARANCE_SELECT =
  'id, event_id, plus_ones, status, created_at, added_by, note, note_priority, events(name, starts_at), guest_tiers(name, color), check_ins(checked_at, checked_by, plus_ones_arrived, voided_at, voided_by), refusals(refused_at, refused_by, reason)';

/** Normalize one embedded guest row (the embeds come back to-one OR to-many). */
function mapAppearance(g: ProfileAppearanceRaw): ContactAppearance {
  const ev = [g.events].flat().filter(Boolean)[0] as ProfileEmbedEvent | undefined;
  const tier = [g.guest_tiers].flat().filter(Boolean)[0] as ProfileEmbedTier | undefined;
  const checkIns = ([g.check_ins].flat().filter(Boolean) as ProfileEmbedCheckIn[]).map((c) => ({
    checkedAt: c.checked_at,
    checkedBy: c.checked_by,
    arrived: c.plus_ones_arrived,
    voidedAt: c.voided_at,
    voidedBy: c.voided_by,
  }));
  const refusals = ([g.refusals].flat().filter(Boolean) as ProfileEmbedRefusal[]).map((r) => ({
    refusedAt: r.refused_at,
    refusedBy: r.refused_by,
    reason: r.reason,
  }));
  return {
    guestId: g.id,
    eventId: g.event_id,
    eventName: ev?.name ?? '',
    eventStartsAt: ev?.starts_at ?? g.created_at,
    plusOnes: g.plus_ones,
    status: g.status,
    tierName: tier?.name ?? null,
    tierColor: tier?.color ?? null,
    note: g.note,
    notePriority: g.note_priority,
    addedBy: g.added_by,
    addedAt: g.created_at,
    checkIns,
    refusals,
  };
}

/** Collect the distinct actor ids across appearances (added / checked / refused). */
function actorIds(appearances: ContactAppearance[]): string[] {
  const ids = new Set<string>();
  for (const a of appearances) {
    ids.add(a.addedBy);
    for (const ci of a.checkIns) {
      ids.add(ci.checkedBy);
      if (ci.voidedBy) ids.add(ci.voidedBy);
    }
    for (const r of a.refusals) ids.add(r.refusedBy);
  }
  return [...ids];
}

/** Every non-removed guest appearance for a contact, with event + tier + the door
 *  history (check-ins, refusals) embedded. RLS scopes both the rows and the embeds.
 *  A single contact's appearances are bounded (events-per-venue × attendance), well
 *  under PostgREST's 1000-row cap, so no ranged paging is needed here. */
async function fetchContactAppearances(client: Client, contactId: string): Promise<ContactAppearance[]> {
  const { data } = await client
    .from('guests')
    .select(PROFILE_APPEARANCE_SELECT)
    .eq('contact_id', contactId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false });

  return ((data ?? []) as ProfileAppearanceRaw[]).map(mapAppearance);
}

/** A single guest row as one appearance — the name-only / guest-keyed path. */
async function fetchGuestAppearance(client: Client, guestId: string): Promise<ContactAppearance[]> {
  const { data } = await client.from('guests').select(PROFILE_APPEARANCE_SELECT).eq('id', guestId);
  return ((data ?? []) as ProfileAppearanceRaw[]).map(mapAppearance);
}

/** Resolve a set of actor ids → display names in one round-trip (RLS-scoped;
 *  an unreadable actor simply drops out and the screen shows a fallback). */
async function fetchActorNames(client: Client, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data } = await client.from('user_profiles').select('id, full_name').in('id', ids);
  const names: Record<string, string> = {};
  for (const p of data ?? []) names[p.id] = p.full_name;
  return names;
}

/** The contact header + all appearances + resolved actor names for the profile.
 *  header is null when the caller can't read the contact (RLS) or it doesn't exist. */
export async function fetchContactProfile(client: Client, contactId: string): Promise<ContactProfileData> {
  const [{ data: c }, appearances] = await Promise.all([
    client
      .from('contacts')
      .select('id, full_name, email, phone, birthdate, preferred_role, note, is_permanent, source, created_at')
      .eq('id', contactId)
      .maybeSingle(),
    fetchContactAppearances(client, contactId),
  ]);

  if (!c) return { header: null, appearances: [], actorNames: {} };

  const actorNames = await fetchActorNames(client, actorIds(appearances));

  return {
    header: {
      id: c.id,
      fullName: c.full_name,
      email: c.email,
      phone: c.phone,
      birthdate: c.birthdate,
      preferredRole: c.preferred_role,
      note: c.note,
      isPermanent: c.is_permanent,
      source: c.source,
      createdAt: c.created_at,
    },
    appearances,
    actorNames,
  };
}

const EMPTY_PERSON: PersonProfileData = {
  header: null,
  appearances: [],
  actorNames: {},
  isContact: false,
  promoteGuestId: null,
};

/**
 * Resolve the unified person profile from a contact id OR a guest id. A guest that
 * is already linked to a contact resolves to the full cross-event contact profile;
 * a name-only guest resolves to a single-appearance profile (isContact false) the
 * caller can promote by adding an e-mail/phone. header is null when nothing is
 * visible (RLS) or found — the screen then shows its not-found state.
 */
export async function fetchPersonProfile(
  client: Client,
  args: { contactId?: string | null; guestId?: string | null }
): Promise<PersonProfileData> {
  if (args.contactId) {
    const data = await fetchContactProfile(client, args.contactId);
    return { ...data, isContact: data.header != null, promoteGuestId: null };
  }
  if (args.guestId) {
    const { data: g } = await client
      .from('guests')
      .select('id, contact_id, full_name, email, phone, note, created_at')
      .eq('id', args.guestId)
      .maybeSingle();
    if (!g) return EMPTY_PERSON;
    // Already a contact → the full cross-event profile.
    if (g.contact_id) {
      const data = await fetchContactProfile(client, g.contact_id);
      return { ...data, isContact: true, promoteGuestId: null };
    }
    // Name-only guest → a one-appearance profile, synthesised from the guest row.
    const appearances = await fetchGuestAppearance(client, g.id);
    const actorNames = await fetchActorNames(client, actorIds(appearances));
    return {
      header: {
        id: g.id,
        fullName: g.full_name,
        email: g.email,
        phone: g.phone,
        birthdate: null,
        preferredRole: null,
        note: g.note,
        isPermanent: false,
        source: 'guest_list',
        createdAt: g.created_at,
      },
      appearances,
      actorNames,
      isContact: false,
      promoteGuestId: g.id,
    };
  }
  return EMPTY_PERSON;
}

// ── Settings cluster reads (S6 team/quota, S7 profile/sessions, S8 venue, billing) ──
// Same client-agnostic shape: a Server Component can prefetch, a Client Component
// reads with the browser client. RLS scopes every row — a staff member who can't
// read the team list simply gets [], which the screen renders as an empty state.

export type PoMemberRow = {
  user_id: string;
  full_name: string;
  email: string;
  roles: Database['public']['Enums']['venue_role'][];
  job_title: string | null;
};

/** Members of a venue (RLS: admin/user_manager/finance may read these). */
export async function fetchVenueMembers(client: Client, venueId: string): Promise<PoMemberRow[]> {
  const { data } = await client
    .from('venue_memberships')
    .select('user_id, roles, job_title, user_profiles(full_name, email)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });

  return (data ?? []).map((row) => ({
    user_id: row.user_id,
    full_name: row.user_profiles?.full_name ?? '—',
    email: row.user_profiles?.email ?? '—',
    roles: row.roles,
    job_title: row.job_title ?? null,
  }));
}

export type PoInviteRow = Pick<
  Tables['invites']['Row'],
  'id' | 'email' | 'roles' | 'expires_at' | 'created_at'
>;

/** Open (un-accepted) invites for a venue (RLS: managers + finance). */
export async function fetchPendingInvites(client: Client, venueId: string): Promise<PoInviteRow[]> {
  const { data } = await client
    .from('invites')
    .select('id, email, roles, expires_at, created_at')
    .eq('venue_id', venueId)
    .is('accepted_at', null)
    .order('created_at', { ascending: false });

  return data ?? [];
}

export type PoMyInviteRow = {
  id: string;
  venue_id: string;
  venue_name: string | null;
  roles: Tables['invites']['Row']['roles'];
};

/** Open invites addressed to the signed-in user (matched by e-mail) — the
 *  "invited to another venue while already logged in" banner (#24). RLS scopes
 *  invites to the invitee; the e-mail filter mirrors the server getMyPendingInvites.
 *  Callable from the browser client. First-login acceptance still happens in
 *  /auth/callback; this covers the mid-session case the desktop banner did. */
export async function fetchMyPendingInvites(client: Client): Promise<PoMyInviteRow[]> {
  const { data: auth } = await client.auth.getUser();
  const email = auth.user?.email;
  if (!email) return [];
  const { data } = await client
    .from('invites')
    .select('id, venue_id, roles, expires_at, venues(name)')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .ilike('email', email)
    .order('created_at', { ascending: false });

  return (data ?? []).map((row) => ({
    id: row.id,
    venue_id: row.venue_id,
    venue_name: row.venues?.name ?? null,
    roles: row.roles,
  }));
}

export type PoQuotaRow = Pick<Tables['quotas']['Row'], 'user_id' | 'default_count'>;

/** Per-member default quotas at a venue (RLS quotas_select: own row, or all for
 *  admin/finance). The caller maps these onto the member list; a missing row
 *  means the member falls back to the venue default. */
export async function fetchMemberQuotas(client: Client, venueId: string): Promise<PoQuotaRow[]> {
  const { data } = await client
    .from('quotas')
    .select('user_id, default_count')
    .eq('venue_id', venueId);

  return data ?? [];
}

export type PoSessionRow = {
  session_id: string;
  created_at: string;
  updated_at: string;
  not_after: string | null;
  user_agent: string | null;
  ip: string | null;
  aal: string | null;
  is_current: boolean;
};

/** The caller's own active sessions (SECURITY DEFINER RPC reads auth.sessions for
 *  auth.uid() — callable from the browser client, scoped to the caller). */
export async function fetchOwnSessions(client: Client): Promise<PoSessionRow[]> {
  const { data } = await client.rpc('list_own_sessions');
  return (data ?? []).map((s) => ({
    session_id: s.session_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
    not_after: s.not_after,
    user_agent: s.user_agent,
    ip: s.ip,
    aal: s.aal,
    is_current: s.is_current ?? false,
  }));
}

/** A team member's active sessions for the admin remote-logout screen. The
 *  SECURITY DEFINER RPC re-enforces admin-at-a-shared-venue + AAL2 (it is the
 *  real boundary); on denial it errors and we surface nothing. Callable from the
 *  browser client — never marks rows as "current" (it is someone else's session). */
export async function fetchUserSessions(client: Client, targetUserId: string): Promise<PoSessionRow[]> {
  const { data } = await client.rpc('admin_list_user_sessions', { p_target: targetUserId });
  return (data ?? []).map((s) => ({
    session_id: s.session_id,
    created_at: s.created_at,
    updated_at: s.updated_at,
    not_after: s.not_after,
    user_agent: s.user_agent,
    ip: s.ip,
    aal: s.aal,
    is_current: false,
  }));
}

export type PoProfileRow = Pick<
  Tables['user_profiles']['Row'],
  'id' | 'full_name' | 'first_name' | 'last_name' | 'email' | 'phone'
>;

/** The caller's own profile (RLS: a user always reads their own row, #24). */
export async function fetchMyProfile(client: Client, userId: string): Promise<PoProfileRow | null> {
  const { data } = await client
    .from('user_profiles')
    .select('id, full_name, first_name, last_name, email, phone')
    .eq('id', userId)
    .maybeSingle();

  return data ?? null;
}

export type PoVenueSettingsRow = Pick<
  Tables['venues']['Row'],
  | 'id'
  | 'name'
  | 'slug'
  | 'retention_months'
  | 'default_personal_quota'
  | 'allow_uncheck'
  | 'company_name'
  | 'kvk_number'
  | 'vat_number'
  | 'finance_email'
  | 'address_line'
  | 'postal_code'
  | 'city'
  | 'country'
>;

/** Venue settings (RLS venues_select: any member reads; only admin may update). */
export async function fetchVenueSettings(
  client: Client,
  venueId: string
): Promise<PoVenueSettingsRow | null> {
  const { data } = await client
    .from('venues')
    .select(
      'id, name, slug, retention_months, default_personal_quota, allow_uncheck, company_name, kvk_number, vat_number, finance_email, address_line, postal_code, city, country'
    )
    .eq('id', venueId)
    .maybeSingle();

  return data ?? null;
}

export type PoSubscriptionRow = Pick<
  Tables['subscriptions']['Row'],
  'status' | 'plan_id' | 'current_period_end'
>;

/** The venue's subscription entitlement (RLS subscriptions_select_member: any
 *  member reads). Read-only — writes flow through Stripe webhooks only (#32). */
export async function fetchSubscription(
  client: Client,
  venueId: string
): Promise<PoSubscriptionRow | null> {
  const { data } = await client
    .from('subscriptions')
    .select('status, plan_id, current_period_end')
    .eq('venue_id', venueId)
    .maybeSingle();

  return data ?? null;
}

// ── Audit log reads (S10 Mobiel Audit-log) ───────────────────────────────────
// Client-agnostic mirror of the SERVER-only src/features/audit/queries.ts so the
// mobile po surface can read the same audit_feed over the BROWSER client (same
// pattern as fetchPoGuests lifting the desktop guests select). RLS
// (audit_log_select_aal2: admin/finance + AAL2, inherited by the view) is the
// boundary — an AAL1 or unauthorised caller simply gets [], and the screen then
// shows its MFA / permission state. The Dutch sentence composition is SHARED
// (describeAuditEntry, translate.ts), so desktop and mobile read identically.

export interface PoAuditFilters {
  venueId: string;
  eventId?: string;
  /** Actor (who performed the action) — "filter op user". */
  actorId?: string;
  /** "filter op actiesoort". */
  action?: string;
  /** Free-text on actor/guest/subject names (server-side ilike). */
  search?: string;
  limit?: number;
}

export interface PoAuditFilterOptions {
  events: { id: string; name: string }[];
  actors: { id: string; name: string }[];
}

// PostgREST `.or()` is comma/paren-delimited; strip those (and `*`) from user
// input so a search term can never break out of the filter expression.
function sanitizeAuditSearch(term: string): string {
  return term.replace(/[,()*]/g, ' ').trim();
}

/** The venue's audit feed, newest first, filtered + capped IN the database. */
export async function fetchPoAuditFeed(
  client: Client,
  filters: PoAuditFilters
): Promise<AuditLine[]> {
  let query = client
    .from('audit_feed')
    .select('*')
    .eq('venue_id', filters.venueId)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.eventId) query = query.eq('event_id', filters.eventId);
  if (filters.actorId) query = query.eq('actor_id', filters.actorId);
  if (filters.action && filters.action !== 'all') query = query.eq('action', filters.action);
  if (filters.search) {
    const s = sanitizeAuditSearch(filters.search);
    if (s) {
      query = query.or(
        `actor_name.ilike.%${s}%,guest_name.ilike.%${s}%,subject_name.ilike.%${s}%`
      );
    }
  }

  const { data } = await query;
  return (data ?? []).map(describeAuditEntry);
}

export interface PoGuestHistory {
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

/** The per-guest "geschiedenis" (#15): every log line that concerns this guest,
 *  oldest first as a story, plus the guest's current snapshot. */
export async function fetchPoGuestHistory(
  client: Client,
  guestId: string
): Promise<PoGuestHistory> {
  const [{ data: rows }, { data: guest }] = await Promise.all([
    client
      .from('audit_feed')
      .select('*')
      .eq('guest_id', guestId)
      .order('created_at', { ascending: true }),
    client
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

/** Filter-sheet options: the venue's events + its members (the people who act in
 *  it) — a small bounded set, far cheaper than DISTINCT over the whole log. */
export async function fetchPoAuditFilterOptions(
  client: Client,
  venueId: string
): Promise<PoAuditFilterOptions> {
  const [{ data: events }, { data: members }] = await Promise.all([
    client
      .from('events')
      .select('id, name, starts_at')
      .eq('venue_id', venueId)
      .order('starts_at', { ascending: false }),
    client
      .from('venue_memberships')
      .select('user_id, user_profiles(full_name)')
      .eq('venue_id', venueId),
  ]);

  return {
    events: (events ?? []).map((e) => ({ id: e.id, name: e.name })),
    actors: (members ?? [])
      .map((m) => ({ id: m.user_id, name: m.user_profiles?.full_name ?? 'Onbekend' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  };
}
