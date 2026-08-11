import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { EventSummary, TierStat } from '@/features/stats/data';
import { describeAuditEntry, type AuditLine } from '@/features/audit/translate';
import { resolveAllowUncheck } from '@/features/events/allow-uncheck';
import { chunkIds, fetchAllRanged } from '@/lib/supabase/paging';
import { eventPhase } from '@/features/po/event-phase';

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
  | 'id'
  | 'full_name'
  | 'plus_ones'
  | 'status'
  | 'tier_id'
  | 'note'
  | 'note_priority'
  | 'note_acknowledged_at'
  | 'created_at'
  | 'contact_id'
>;

export type PoTierRow = Pick<
  Tables['guest_tiers']['Row'],
  'id' | 'name' | 'color' | 'max_guests' | 'aliases' | 'door_price_cents' | 'vat_percent'
>;

/** A guest row that also carries its `event_id` — the venue-wide ("all guests")
 *  list needs it to badge + deep-link each row to its own event. */
export type PoVenueGuestRow = PoGuestRow & Pick<Tables['guests']['Row'], 'event_id'>;

/**
 * All events for a venue, newest first (RLS: members read their venue's events).
 * `sinceIso` is an optional lower bound on `starts_at` (86ey9e8gt) — omit for the
 * full history (Events tab's "Past" view, stats); pass it from a poll that only
 * cares about recent + upcoming events so its cost doesn't grow with venue age.
 */
export async function fetchEvents(client: Client, venueId: string, sinceIso?: string): Promise<PoEventRow[]> {
  let query = client
    .from('events')
    .select('id, name, starts_at, ends_at, status, cancelled_at, list_locked, venues(name)')
    .eq('venue_id', venueId)
    .order('starts_at', { ascending: false });
  if (sinceIso) query = query.gte('starts_at', sinceIso);
  const { data, error } = await query;
  if (error) throw error;

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
 * Active guests (soft-deleted excluded) of ONE event, oldest first — the po
 * surface's canonical single-event guest read (door/cockpit list, bulk dedupe),
 * lifted out of the desktop `(app)/events/[eventId]/guests/page.tsx` inline
 * select so the Server Component and the mobile Client Components share one query
 * shape (STAP 3.4). Runs through the USER-scoped client, so RLS stays the
 * boundary — staff see only their own guests, an out-of-scope event yields [].
 * The desktop page keeps its own richer select (email/phone/source for the edit
 * form); this lean projection is exactly what `toPoGuest` needs. `event_id` is
 * selected (cheap) so callers that badge a row by event can reuse this shape.
 *
 * Status filter (M4/#44 — was `.neq('status', 'removed')`, which let a
 * `pending`/`denied` row leak in as a phantom "on the way" guest: the po
 * `Guest.status` type only has in/wait/refused, so `guestStatusToPo` collapsed
 * it into 'wait', silently inflating the cockpit's on-list count by one relative
 * to the door). Matches `ON_LIST` above, plus `refused` since screens here still
 * render those rows, just never count them on-list.
 *
 * Ranged: a 1500-guest event would truncate at PostgREST's 1000-row cap, hiding
 * the rest. `created_at` isn't unique, so `.order('id')` is the tiebreaker that
 * makes the page order deterministic (no overlap/skip across `.range()` windows).
 *
 * The venue-WIDE "all guests" list does NOT use this — a per-event fetcher over
 * a whole venue pages every guest of every event to the browser. Use the
 * windowed + server-searched {@link fetchVenueGuestsWindow} for that (86ey9e8hz).
 */
export async function fetchGuests(client: Client, eventId: string): Promise<PoVenueGuestRow[]> {
  return fetchAllRanged<PoVenueGuestRow>((from, to) =>
    client
      .from('guests')
      .select('id, full_name, plus_ones, status, tier_id, note, note_priority, note_acknowledged_at, created_at, contact_id, event_id')
      .eq('event_id', eventId)
      .in('status', [...ON_LIST, 'refused'])
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  );
}

/** Rows the venue-wide "all guests" list pulls at once (86ey9e8hz). The tab is a
 *  working SET, not the whole venue: rows come newest-first, name search is pushed
 *  to the server so it reaches past the window, and the list virtualizes the DOM.
 *  200 covers a small venue's entire history unchanged, while a 25 000-guest venue
 *  loads ONE bounded page instead of ~25 sequential full-table pages. */
export const VENUE_GUESTS_WINDOW = 200;

/** The `guest_tiers(name, color)` embed comes back to-one OR to-many depending on
 *  the generated client — normalize with `[x].flat()` before reading. */
type VenueGuestTierEmbed = { name: string; color: string | null };
type PoVenueGuestRaw = PoVenueGuestRow & {
  guest_tiers: VenueGuestTierEmbed | VenueGuestTierEmbed[] | null;
};

/** A venue-wide guest row with its tier flattened out of the embed. */
export interface PoVenueGuestWithTier extends PoVenueGuestRow {
  tierName: string | null;
  tierColor: string | null;
}

export interface VenueGuestsPage {
  rows: PoVenueGuestWithTier[];
  /** Total matching guests across the venue (respects the search filter + RLS) —
   *  the "of N" in the list subtitle. May exceed rows.length: the remainder is
   *  reachable by searching, not by scrolling. */
  total: number;
}

/**
 * The Guests-tab "All events" working set (86ey9e8hz): the newest
 * {@link VENUE_GUESTS_WINDOW} on-list/refused guests across the venue, each with
 * its tier from the embed (no separate venue-wide tier read) and a total count
 * for the subtitle. `search` is pushed down as a server-side `ilike` on
 * `full_name`, so a name outside the window is still findable without downloading
 * the whole venue — the anti-pattern this replaces paged EVERY venue guest to the
 * browser (~25 sequential requests + the full snapshot at 25 000 guests),
 * re-sorted and re-filtered client-side on every keystroke. RLS stays the
 * boundary (staff see only their own). Ordered newest-first in SQL
 * (`created_at desc, id desc`) so no client re-sort is needed; `id` is the
 * deterministic tiebreaker.
 *
 * Note: at very large N the `ilike '%term%'` is a sequential scan (no leading-
 * anchor index) — fine at 25 000, and a pg_trgm index is the ≥100-venue follow-up
 * if search latency ever shows up, not a reason to widen scope now.
 */
export async function fetchVenueGuestsWindow(
  client: Client,
  args: { venueId: string; search?: string; limit?: number },
): Promise<VenueGuestsPage> {
  const limit = args.limit ?? VENUE_GUESTS_WINDOW;
  let query = client
    .from('guests')
    .select(
      'id, full_name, plus_ones, status, tier_id, note, note_priority, note_acknowledged_at, created_at, contact_id, event_id, guest_tiers(name, color)',
      { count: 'exact' },
    )
    .eq('venue_id', args.venueId)
    .in('status', [...ON_LIST, 'refused'])
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(0, limit - 1);

  // Same `%term%` shape as fetchContacts: supabase-js sends it as a value (no
  // filter-string injection), and a stray %/_ acting as a wildcard is a harmless
  // search nicety, not a bug.
  const term = args.search?.trim();
  if (term) query = query.ilike('full_name', `%${term}%`);

  const { data, error, count } = await query;
  if (error) throw error;

  const rows: PoVenueGuestWithTier[] = ((data ?? []) as PoVenueGuestRaw[]).map(
    ({ guest_tiers, ...g }) => {
      const tier = [guest_tiers].flat().filter(Boolean)[0] as VenueGuestTierEmbed | undefined;
      return { ...g, tierName: tier?.name ?? null, tierColor: tier?.color ?? null };
    },
  );
  return { rows, total: count ?? rows.length };
}

export interface ExistingEventGuest {
  id: string;
  name: string;
  plusOnes: number;
}

/**
 * Authoritative duplicate lookup for the add flows (86ey8w7ek): is `name`
 * already on this event's list? One indexed point query (RPC
 * `find_event_guest_by_name`, SECURITY INVOKER → RLS-scoped exactly like the
 * list read: staff only match their own guests), so it stays instant at
 * thousands of guests and works before/without the guest list having loaded.
 * `removed` rows never match (#21). Throws on failure — callers decide their
 * fallback; a silent null here would let duplicates through unnoticed.
 */
export async function findEventGuestByName(
  client: Client,
  eventId: string,
  name: string
): Promise<ExistingEventGuest | null> {
  const { data, error } = await client.rpc('find_event_guest_by_name', {
    p_event_id: eventId,
    p_name: name,
  });
  if (error) throw error;
  const row = data?.[0];
  return row ? { id: row.id, name: row.full_name, plusOnes: row.plus_ones } : null;
}

/** Max names per `find_event_guests_by_names` call — mirrors the RPC's own cap
 *  and the CLAUDE.md id-chunking rule; a bulk paste/selection chunks into
 *  several calls rather than one unbounded array. */
const BULK_DUPE_CHECK_CHUNK = 100;

/**
 * Set-based sibling of {@link findEventGuestByName} for bulk-paste and bulk
 * add-to-event (86ey8xg4p, follow-up to 86ey8w7ek): one authoritative,
 * RLS-scoped lookup per chunk of names instead of N point lookups, so the
 * safeguard holds at thousands of guests. Duplicate/blank names are folded;
 * throws on failure — callers decide their fallback (mirrors the singular
 * lookup so an offline/deploy-skew failure never fails silently).
 */
export async function findEventGuestsByNames(
  client: Client,
  eventId: string,
  names: string[]
): Promise<ExistingEventGuest[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  const out: ExistingEventGuest[] = [];
  for (let i = 0; i < unique.length; i += BULK_DUPE_CHECK_CHUNK) {
    const chunk = unique.slice(i, i + BULK_DUPE_CHECK_CHUNK);
    const { data, error } = await client.rpc('find_event_guests_by_names', {
      p_event_id: eventId,
      p_names: chunk,
    });
    if (error) throw error;
    for (const row of data ?? []) {
      out.push({ id: row.id, name: row.full_name, plusOnes: row.plus_ones });
    }
  }
  return out;
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
  const { data, error } = await client
    .rpc('event_quota_status', { p_event_id: eventId })
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    quota: data.quota,
    consumed: data.consumed,
    remaining: data.exempt ? null : data.remaining,
    exempt: data.exempt,
  };
}

export type TierScope = { eventId: string } | { venueId: string };

/**
 * Tiers of an event, or every tier at a venue (the venue-wide "all guests" list
 * resolves a guest's role by tier id regardless of event — tier ids are
 * globally unique). Same scope shape as `fetchGuests` (SCALE-5/FE-3): a
 * venue-wide read sends ONE venue_id, never an event-id list. RLS: members
 * read their venue's tiers.
 */
export async function fetchTiers(client: Client, scope: TierScope): Promise<PoTierRow[]> {
  const query = client
    .from('guest_tiers')
    .select('id, name, color, max_guests, aliases, door_price_cents, vat_percent')
    .order('name', { ascending: true });

  const { data, error } = await ('eventId' in scope ? query.eq('event_id', scope.eventId) : query.eq('venue_id', scope.venueId));
  if (error) throw error;
  return data ?? [];
}

export interface EventHeadcount {
  /** On-list headcount (1 + plus-ones over approved/checked-in guests). */
  registered: number;
  /** Present headcount (1 + plus-ones over checked-in guests). */
  present: number;
}

/**
 * Registered + present headcounts for every event at a venue, in ONE aggregate
 * RPC (K8/SCALE-5 — this used to download every on-list guest ROW of every
 * event and sum client-side, `.in('event_id', eventIds)`, which both shipped
 * far more data than needed and 414'd past ~205 events). `venue_event_headcounts`
 * is SECURITY INVOKER (no bypass): it runs under the caller's own
 * `guests_select` visibility, so a staff member's tile still only counts their
 * own added guests, exactly like the row-by-row read it replaces.
 *
 * `sinceIso` (86ey9e8gt) is an optional lower bound on the event's `starts_at`,
 * mirroring `fetchEvents`'s window — omit for every event ever (today's
 * behaviour), pass it from a poll that should stay flat as the venue ages.
 */
export async function fetchEventHeadcounts(
  client: Client,
  venueId: string,
  sinceIso?: string
): Promise<Map<string, EventHeadcount>> {
  const counts = new Map<string, EventHeadcount>();
  // Throw, don't swallow: a silently-eaten error here rendered every stat tile
  // as a plausible-looking 0 for days when prod missed the RPC's migration
  // (12/7). React Query's error state + Sentry must see schema drift.
  const { data, error } = await client.rpc('venue_event_headcounts', {
    p_venue_id: venueId,
    ...(sinceIso ? { p_since: sinceIso } : {}),
  });
  if (error) throw error;
  for (const row of data ?? []) {
    counts.set(row.event_id, { registered: row.registered, present: row.present });
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

/**
 * Most recent (non-voided) check-ins for an event — drives "Laatst binnen". Filters
 * on `check_ins.event_id` directly (denormalized, see fetchCheckinArrivals above);
 * the `guests!inner(id, full_name)` embed stays because the returned rows need the
 * guest's name — `!inner` keeps `r.guests` non-nullable so `r.guests.id`/
 * `r.guests.full_name` below don't need a null check.
 */
export async function fetchRecentCheckins(
  client: Client,
  eventId: string,
  limit = 3
): Promise<RecentCheckinRow[]> {
  const { data, error } = await client
    .from('check_ins')
    .select('checked_at, plus_ones_arrived, checked_by, guests!inner(id, full_name)')
    .eq('event_id', eventId)
    .is('voided_at', null)
    .order('checked_at', { ascending: false })
    .limit(limit);
  if (error) throw error;

  const rows = data ?? [];
  // Resolve the checker names in one round-trip (RLS: door roles read profiles).
  const ids = [...new Set(rows.map((r) => r.checked_by))];
  const profilesRes = ids.length
    ? await client.from('user_profiles').select('id, full_name').in('id', ids)
    : { data: [] as { id: string; full_name: string }[], error: null };
  if (profilesRes.error) throw profilesRes.error;
  const profiles = profilesRes.data ?? [];
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
  const { count, error } = await client
    .from('guest_requests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'pending');
  if (error) throw error;

  return count ?? 0;
}

/**
 * Count of open (pending) quota requests for an event. Counted alongside the
 * guest requests in the event-detail nudge (86ey8w7bm): they were invisible
 * there, so the badge and the approvals inbox disagreed. RLS keeps this
 * role-relative (a non-admin only counts their own requests) — the screen
 * additionally gates the combined badge to admins.
 */
export async function fetchOpenQuotaRequestCount(client: Client, eventId: string): Promise<number> {
  const { count, error } = await client
    .from('quota_requests')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', eventId)
    .eq('status', 'pending');
  if (error) throw error;

  return count ?? 0;
}

// ── Approvals reads (S5 Aanvragen, STAP 3.6) ──────────────────────────────────
// Pending landing-page guest requests (#12/#31) + pending quota requests (#5),
// read VENUE-WIDE (one venue_id, SCALE-5 — was an `.in(eventIds)` list sourced
// from usePoEvents, which 414s past ~205 events) so the inbox can show "Alle
// events" + an event picker. RLS stays the boundary on the requests themselves
// — admin sees every event's, an organizer only their own events'. Each row
// carries its event_id so the screen can group/filter and target the right
// event's tiers on approval.

export type PoGuestRequestRow = Pick<
  Tables['guest_requests']['Row'],
  | 'id'
  | 'full_name'
  | 'phone'
  | 'plus_ones'
  | 'motivation'
  | 'created_at'
  | 'event_id'
  | 'status'
  | 'decision_reason'
  | 'request_link_id'
  | 'decided_via'
> & {
  /** Resolved link identity (influencer name ?? label); null for the default
   *  link, a legacy pre-links request, or an unreadable link (RLS). */
  viaLabel: string | null;
};

/** Resolve request_link_id → "via" label (influencer name ?? label) in two
 *  RLS-safe round-trips (no FK-embed guessing — mirrors fetchQuotaRequests).
 *  The default link resolves to null: it has no influencer and no label. */
async function fetchLinkLabels(client: Client, linkIds: string[]): Promise<Map<string, string | null>> {
  const labels = new Map<string, string | null>();
  if (linkIds.length === 0) return labels;
  const { data: links, error } = await client
    .from('request_links')
    .select('id, label, influencer_id')
    .in('id', linkIds);
  if (error) throw error;
  const rows = links ?? [];
  const infIds = [...new Set(rows.map((l) => l.influencer_id).filter((x): x is string => !!x))];
  const infRes = infIds.length
    ? await client.from('influencers').select('id, name').in('id', infIds)
    : { data: [] as { id: string; name: string }[], error: null };
  if (infRes.error) throw infRes.error;
  const influencers = infRes.data ?? [];
  const nameById = new Map(influencers.map((i) => [i.id, i.name]));
  for (const l of rows) {
    labels.set(l.id, (l.influencer_id ? nameById.get(l.influencer_id) : null) ?? l.label ?? null);
  }
  return labels;
}

/**
 * Landing-page requests across the given events — still-open (pending),
 * already-DENIED, and AUTO-APPROVED (the read-only trace of what an auto-approve
 * link let straight onto the list), oldest first. The screen shows the open ones
 * as the queue, the denied ones in a "Declined" section (an admin can still add
 * the person after all — re-approve, #12), and the auto-approved ones in their own
 * collapsed section. Manually-approved requests stay excluded (they're on the
 * list already, decided by a human). Each row carries its request link resolved
 * to a "via" label. RLS limits visibility to admin/finance/organizer.
 */
export async function fetchGuestRequests(
  client: Client,
  venueId: string
): Promise<PoGuestRequestRow[]> {
  const { data, error } = await client
    .from('guest_requests')
    .select(
      'id, full_name, phone, plus_ones, motivation, created_at, event_id, status, decision_reason, request_link_id, decided_via'
    )
    .eq('venue_id', venueId)
    .or('status.in.(pending,denied),and(status.eq.approved,decided_via.eq.auto)')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const linkIds = [...new Set(rows.map((r) => r.request_link_id).filter((x): x is string => !!x))];
  const labels = await fetchLinkLabels(client, linkIds);
  return rows.map((r) => ({
    ...r,
    viaLabel: r.request_link_id ? labels.get(r.request_link_id) ?? null : null,
  }));
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
  venueId: string
): Promise<PoQuotaRequestRow[]> {
  const { data: reqs, error } = await client
    .from('quota_requests')
    .select('id, event_id, requested_extra, motivation, created_at, user_id')
    .eq('venue_id', venueId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = reqs ?? [];
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const profilesRes = ids.length
    ? await client.from('user_profiles').select('id, full_name').in('id', ids)
    : { data: [] as { id: string; full_name: string }[], error: null };
  if (profilesRes.error) throw profilesRes.error;
  const profiles = profilesRes.data ?? [];
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
  /** guest_tiers.color — drives the door-style tier pill in the recap list. */
  tierColor: string | null;
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
  guest_tiers: { name: string; color: string | null } | { name: string; color: string | null }[] | null;
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
        'id, full_name, plus_ones, status, guest_tiers(name, color), added_by_profile:user_profiles!guests_added_by_fkey(full_name), check_ins(checked_at, voided_at)'
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
    const tier = [g.guest_tiers].flat().filter(Boolean)[0] as { name: string; color: string | null } | undefined;
    const addedBy = [g.added_by_profile].flat().filter(Boolean)[0] as { full_name: string } | undefined;
    return {
      id: g.id,
      full_name: g.full_name,
      plus_ones: g.plus_ones,
      status: g.status,
      tierName: tier?.name ?? null,
      tierColor: tier?.color ?? null,
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
  if (summary.error) throw summary.error;
  if (tiers.error) throw tiers.error;
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
  /** Per-event default member quota (T10) — seeds the add-crew prefill; editable per event. */
  defaultMemberQuota: number;
}

/** A single event with the editable fields + the caller's organizer scope (EventEdit). */
export async function fetchEventForEdit(
  client: Client,
  eventId: string,
  userId: string
): Promise<EventEditRow | null> {
  const [{ data: e, error: eErr }, { data: org, error: orgErr }] = await Promise.all([
    client
      .from('events')
      .select(
        'id, name, starts_at, ends_at, status, cancelled_at, landing_active, landing_slug, list_locked, auto_lock_at, allow_uncheck, default_member_quota, venues(name, allow_uncheck)'
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
  if (eErr) throw eErr;
  if (orgErr) throw orgErr;
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
    defaultMemberQuota: e.default_member_quota,
  };
}

export interface CheckinArrival {
  /** plus_ones_arrived on the active check-in (actual companions present). */
  arrived: number;
  /** ISO check-in time, for "Binnen · HH:MM". */
  at: string;
  /**
   * The check_ins row id. The check-out sends it along so the write can only hit
   * the check-in the cockpit was actually looking at — a peer's newer row is a
   * 0-row no-op rather than a hijacked check-in (#35). Absent on an optimistic
   * patch, where no server row is known yet.
   */
  id?: string;
}

type CheckinArrivalRow = Pick<Tables['check_ins']['Row'], 'id' | 'guest_id' | 'plus_ones_arrived' | 'checked_at'>;

/**
 * Active (non-voided) check-in arrivals for an event's guests, keyed by guest id.
 * The cockpit (S13) uses this for the ACTUAL present headcount and partial-arrival
 * display (a +3 guest with 1 companion present = 2 koppen binnen, not 4). Filters
 * on the denormalized `event_id` (mirrors the door's `check_ins`/`refusals` reads
 * in `fetchDoorSnapshot`, `src/features/door/queries.ts` — migration
 * `20260622140000_checkin_event_scope`, unconditionally server-derived since
 * `20260713190000_checkin_scope_venue_pin`) — no `.in('guest_id', …)` list that
 * would blow Kong's URI length at 1500 ids. Voiding is filtered server-side
 * (`check_ins.guest_id` is UNIQUE, so this can't under-return). Ranged so >1000
 * check-ins all load; `.order('id')` gives the deterministic order paging
 * requires. RLS still gates which check_ins are visible.
 */
export async function fetchCheckinArrivals(
  client: Client,
  eventId: string
): Promise<Map<string, CheckinArrival>> {
  const rows = await fetchAllRanged<CheckinArrivalRow>((from, to) =>
    client
      .from('check_ins')
      .select('id, guest_id, plus_ones_arrived, checked_at')
      .eq('event_id', eventId)
      .is('voided_at', null)
      .order('id')
      .range(from, to),
  );

  const map = new Map<string, CheckinArrival>();
  for (const row of rows) {
    map.set(row.guest_id, { arrived: row.plus_ones_arrived, at: row.checked_at, id: row.id });
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
  const [{ data: tiers, error: tiersErr }, guests] = await Promise.all([
    client.from('guest_tiers').select('id, name, color, max_guests, aliases, door_price_cents, vat_percent').eq('event_id', eventId).order('name'),
    // Ranged: occupancy counts every non-removed/denied guest, so a 1500-guest
    // event would otherwise truncate the count at 1000. `.order('id')` keys the paging.
    fetchAllRanged<Pick<Tables['guests']['Row'], 'tier_id' | 'status'>>((from, to) =>
      client.from('guests').select('tier_id, status').eq('event_id', eventId).order('id').range(from, to),
    ),
  ]);
  if (tiersErr) throw tiersErr;

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
  const [{ data: crew, error: crewErr }, { data: quotas, error: quotasErr }] = await Promise.all([
    client.from('event_organizers').select('user_id, user_profiles(full_name, email)').eq('event_id', eventId),
    // event_quotas RLS: admin/finance read all for the venue's events (a member
    // reads only their own row) — a non-admin viewer just sees 0 here, which is fine.
    client.from('event_quotas').select('user_id, quota_override').eq('event_id', eventId),
  ]);
  if (crewErr) throw crewErr;
  if (quotasErr) throw quotasErr;

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
  const { data: ev, error: evErr } = await client.from('events').select('venue_id').eq('id', eventId).maybeSingle();
  if (evErr) throw evErr;
  if (!ev) return [];
  const venueId = ev.venue_id;

  const [
    { data: orgRows, error: orgErr },
    { data: members, error: membersErr },
    { data: current, error: currentErr },
  ] = await Promise.all([
    client
      .from('event_organizers')
      .select('user_id, user_profiles(full_name, email), events!inner(venue_id)')
      .eq('events.venue_id', venueId),
    client.from('venue_memberships').select('user_id').eq('venue_id', venueId),
    client.from('event_organizers').select('user_id').eq('event_id', eventId),
  ]);
  if (orgErr) throw orgErr;
  if (membersErr) throw membersErr;
  if (currentErr) throw currentErr;

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

/** One venue-wide External-crew row (T8): a person who is event-scoped crew on
 *  ≥1 of the venue's events but NOT a venue member. */
export interface PoVenueCrewRow {
  user_id: string;
  full_name: string;
  email: string;
  /** Names of this venue's events the person is crew on, soonest first. */
  event_names: string[];
  /** Whether the person ever completed a first login (terms accepted at app
   *  entry) — null means the crew invite is still unanswered. */
  terms_accepted_at: string | null;
}

/**
 * Every external-crew person at a venue (event_organizers across ALL its
 * events, deduped, venue members excluded) — the Team screen's second section
 * (T8). Crew who have never logged in (terms_accepted_at null) render as a
 * pending invite with a resend. RLS: any venue member may read the rows; the
 * screen itself is gated to viewTeam.
 */
export async function fetchVenueCrew(client: Client, venueId: string): Promise<PoVenueCrewRow[]> {
  const [{ data: orgRows, error: orgErr }, { data: members, error: membersErr }] = await Promise.all([
    client
      .from('event_organizers')
      .select('user_id, user_profiles(full_name, email, terms_accepted_at), events!inner(name, starts_at, venue_id)')
      .eq('events.venue_id', venueId),
    client.from('venue_memberships').select('user_id').eq('venue_id', venueId),
  ]);
  if (orgErr) throw orgErr;
  if (membersErr) throw membersErr;

  const memberIds = new Set((members ?? []).map((m) => m.user_id));
  const byUser = new Map<string, PoVenueCrewRow & { starts: string[] }>();
  for (const r of orgRows ?? []) {
    if (memberIds.has(r.user_id)) continue;
    const entry = byUser.get(r.user_id) ?? {
      user_id: r.user_id,
      full_name: r.user_profiles?.full_name ?? '—',
      email: r.user_profiles?.email ?? '—',
      event_names: [],
      terms_accepted_at: r.user_profiles?.terms_accepted_at ?? null,
      starts: [],
    };
    if (r.events) {
      entry.event_names.push(r.events.name);
      entry.starts.push(r.events.starts_at);
    }
    byUser.set(r.user_id, entry);
  }

  return Array.from(byUser.values())
    .map(({ starts, ...row }) => ({
      ...row,
      event_names: row.event_names
        .map((name, i) => ({ name, at: starts[i] ?? '' }))
        .sort((a, b) => a.at.localeCompare(b.at))
        .map((e) => e.name),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
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
  'id' | 'name' | 'description' | 'color' | 'max_guests' | 'door_price_cents' | 'vat_percent' | 'aliases' | 'position'
>;

/** Every template of a venue with its tier count, name-sorted. */
export async function fetchTemplates(client: Client, venueId: string): Promise<PoTemplateRow[]> {
  const { data, error } = await client
    .from('event_templates')
    .select(
      'id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes, event_template_tiers(count)',
    )
    .eq('venue_id', venueId)
    .order('name');
  if (error) throw error;
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
  const { data, error } = await client
    .from('event_templates')
    .select('id, venue_id, name, capacity, allow_uncheck, landing_active, auto_lock_offset_minutes')
    .eq('id', templateId)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

/** A template's tiers in seeding order (position, then creation). */
export async function fetchTemplateTiers(client: Client, templateId: string): Promise<PoTemplateTierRow[]> {
  const { data, error } = await client
    .from('event_template_tiers')
    .select('id, name, description, color, max_guests, door_price_cents, vat_percent, aliases, position')
    .eq('template_id', templateId)
    .order('position')
    .order('created_at');
  if (error) throw error;
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
  const { count, error } = await client
    .from('event_organizers')
    .select('event_id, events!inner(venue_id)', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('events.venue_id', venueId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/**
 * Every event id at this venue the caller organizes (86ey9tkav) — the bulk,
 * per-event counterpart to fetchOrganizesAtVenue's single boolean. Feeds the
 * Home board's per-row "admin OR organizer of THIS event" manage-gate
 * (mirrors events_update_admin_organizer RLS / fetchEventForEdit's isOrganizer)
 * without an N+1 query per card: one venue-scoped read, same shape as
 * fetchOrganizesOpenEventAtVenue.
 */
export async function fetchOrganizerEventIds(
  client: Client,
  venueId: string,
  userId: string
): Promise<Set<string>> {
  if (!userId || !venueId) return new Set();
  const { data, error } = await client
    .from('event_organizers')
    .select('event_id, events!inner(venue_id)')
    .eq('user_id', userId)
    .eq('events.venue_id', venueId);
  if (error) throw error;
  return new Set((data ?? []).map((row) => row.event_id));
}

/**
 * Whether the caller organizes a still-workable event at this venue — a live/
 * upcoming, non-cancelled event (M2, K-6): an external crew member with no venue
 * role otherwise has no in-app route to a door surface, even though RLS
 * (`can_check_in`) already lets them work the door of their own event. Phase is
 * computed client-side (`eventPhase`, #26 — the DB has no "past" status), mirroring
 * `doorCandidates`' own filter so this answers exactly "would the Deur-tab have
 * something to show them".
 */
export async function fetchOrganizesOpenEventAtVenue(
  client: Client,
  venueId: string,
  userId: string,
  nowMs: number
): Promise<boolean> {
  if (!userId || !venueId) return false;
  const { data, error } = await client
    .from('event_organizers')
    .select('events!inner(venue_id, starts_at, ends_at, cancelled_at)')
    .eq('user_id', userId)
    .eq('events.venue_id', venueId);
  if (error) throw error;
  return (data ?? []).some((row) => {
    const event = row.events;
    return event.cancelled_at == null && eventPhase(event.starts_at, event.ends_at, nowMs) !== 'past';
  });
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
  /** True when the guest IS linked to a contact, but the caller can't read that
   *  contacts row (RLS: admin/finance/organizer only — staff/doorhost can't).
   *  The profile still renders name-only, synthesised from the guest row they
   *  CAN read (M3, K-8) — never the "not found" dead end, and never a "Save as
   *  contact" promote CTA (it's already a contact, just not visible to them). */
  restricted: boolean;
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
  const { data, error } = await client
    .from('guests')
    .select(PROFILE_APPEARANCE_SELECT)
    .eq('contact_id', contactId)
    .neq('status', 'removed')
    .order('created_at', { ascending: false });
  if (error) throw error;

  return ((data ?? []) as ProfileAppearanceRaw[]).map(mapAppearance);
}

/** A single guest row as one appearance — the name-only / guest-keyed path. */
async function fetchGuestAppearance(client: Client, guestId: string): Promise<ContactAppearance[]> {
  const { data, error } = await client.from('guests').select(PROFILE_APPEARANCE_SELECT).eq('id', guestId);
  if (error) throw error;
  return ((data ?? []) as ProfileAppearanceRaw[]).map(mapAppearance);
}

/** Resolve a set of actor ids → display names in one round-trip (RLS-scoped;
 *  an unreadable actor simply drops out and the screen shows a fallback). */
async function fetchActorNames(client: Client, ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const { data, error } = await client.from('user_profiles').select('id, full_name').in('id', ids);
  if (error) throw error;
  const names: Record<string, string> = {};
  for (const p of data ?? []) names[p.id] = p.full_name;
  return names;
}

/** The contact header + all appearances + resolved actor names for the profile.
 *  header is null when the caller can't read the contact (RLS) or it doesn't exist. */
export async function fetchContactProfile(client: Client, contactId: string): Promise<ContactProfileData> {
  const [{ data: c, error: cErr }, appearances] = await Promise.all([
    client
      .from('contacts')
      .select('id, full_name, email, phone, birthdate, preferred_role, note, is_permanent, source, created_at')
      .eq('id', contactId)
      .maybeSingle(),
    fetchContactAppearances(client, contactId),
  ]);
  if (cErr) throw cErr;

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
  restricted: false,
};

/**
 * Resolve the unified person profile from a contact id OR a guest id. A guest that
 * is already linked to a contact resolves to the full cross-event contact profile
 * — UNLESS the caller can't read `contacts` (RLS: admin/finance/organizer only),
 * in which case it falls back to the name-only single-appearance profile below
 * instead of a dead end (M3, K-8: a doorhost/staff tap on any guest must open
 * SOME profile, never "not available"). A genuinely name-only guest resolves to
 * that same shape (isContact false) so the caller can promote it by adding an
 * e-mail/phone. header is null only when the guest itself doesn't exist / isn't
 * visible — the screen then shows its not-found state.
 */
export async function fetchPersonProfile(
  client: Client,
  args: { contactId?: string | null; guestId?: string | null }
): Promise<PersonProfileData> {
  if (args.contactId) {
    const data = await fetchContactProfile(client, args.contactId);
    return { ...data, isContact: data.header != null, promoteGuestId: null, restricted: false };
  }
  if (args.guestId) {
    const { data: g, error: gErr } = await client
      .from('guests')
      .select('id, contact_id, full_name, email, phone, note, created_at')
      .eq('id', args.guestId)
      .maybeSingle();
    if (gErr) throw gErr;
    if (!g) return EMPTY_PERSON;
    // Already a contact AND the caller can read it → the full cross-event profile.
    if (g.contact_id) {
      const data = await fetchContactProfile(client, g.contact_id);
      if (data.header) return { ...data, isContact: true, promoteGuestId: null, restricted: false };
    }
    // Name-only guest, OR a linked guest whose contact record RLS hides from this
    // caller → a one-appearance profile synthesised from the guest row (readable
    // via the guests RLS, which is far more permissive than contacts).
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
      // A restricted (already-linked) guest never offers the "Save as contact"
      // promote flow — it's already a contact, just not visible to this caller.
      promoteGuestId: g.contact_id ? null : g.id,
      restricted: !!g.contact_id,
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
  const { data, error } = await client
    .from('venue_memberships')
    .select('user_id, roles, job_title, user_profiles(full_name, email)')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: true });
  if (error) throw error;

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
  'id' | 'email' | 'roles' | 'expires_at' | 'created_at' | 'accepted_at'
>;

/** Invites for a venue, accepted ones included so the team screen can show the
 *  accepted/pending/expired status per invite (T8). Newest first, capped — old
 *  accepted invites are audit history, not team-screen material. RLS: managers
 *  + finance. */
export async function fetchVenueInvites(client: Client, venueId: string): Promise<PoInviteRow[]> {
  const { data, error } = await client
    .from('invites')
    .select('id, email, roles, expires_at, created_at, accepted_at')
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) throw error;

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
  const { data: auth, error: authErr } = await client.auth.getUser();
  if (authErr) throw authErr;
  const email = auth.user?.email;
  if (!email) return [];
  const { data, error } = await client
    .from('invites')
    .select('id, venue_id, roles, expires_at, venues(name)')
    .is('accepted_at', null)
    .gt('expires_at', new Date().toISOString())
    .ilike('email', email)
    .order('created_at', { ascending: false });
  if (error) throw error;

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
  const { data, error } = await client
    .from('quotas')
    .select('user_id, default_count')
    .eq('venue_id', venueId);
  if (error) throw error;

  return data ?? [];
}

export type PoEventQuotaOverrideRow = { user_id: string; quota_override: number };

/** This event's per-member quota overrides (event_quotas), keyed by user. RLS:
 *  admin/finance read all for the venue's events, a member reads only their own row. */
export async function fetchEventQuotaOverrides(
  client: Client,
  eventId: string
): Promise<PoEventQuotaOverrideRow[]> {
  const { data, error } = await client
    .from('event_quotas')
    .select('user_id, quota_override')
    .eq('event_id', eventId);
  if (error) throw error;

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
  const { data, error } = await client.rpc('list_own_sessions');
  if (error) throw error;
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
 *  SECURITY DEFINER RPC re-enforces admin-at-a-shared-venue (role-only, #MFA
 *  fully-optional — it is the real boundary); on denial it raises, which we now
 *  throw so React Query's isError fires instead of rendering "no sessions" for
 *  both a genuine denial and an outage. Callable from the browser client — never
 *  marks rows as "current" (it is someone else's session). */
export async function fetchUserSessions(client: Client, targetUserId: string): Promise<PoSessionRow[]> {
  const { data, error } = await client.rpc('admin_list_user_sessions', { p_target: targetUserId });
  if (error) throw error;
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
  const { data, error } = await client
    .from('user_profiles')
    .select('id, full_name, first_name, last_name, email, phone')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;

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
  const { data, error } = await client
    .from('venues')
    .select(
      'id, name, slug, retention_months, default_personal_quota, allow_uncheck, company_name, kvk_number, vat_number, finance_email, address_line, postal_code, city, country'
    )
    .eq('id', venueId)
    .maybeSingle();
  if (error) throw error;

  return data ?? null;
}

export type PoSubscriptionRow = Pick<
  Tables['subscriptions']['Row'],
  'status' | 'plan_id' | 'current_period_end' | 'created_at' | 'stripe_subscription_id'
>;

/** The venue's subscription entitlement (RLS subscriptions_select_member: any
 *  member reads). Read-only — writes flow through Stripe webhooks only (#32).
 *  created_at + stripe_subscription_id feed the trial countdown / checkout CTA
 *  (fase 13 PR 2). */
export async function fetchSubscription(
  client: Client,
  venueId: string
): Promise<PoSubscriptionRow | null> {
  const { data, error } = await client
    .from('subscriptions')
    .select('status, plan_id, current_period_end, created_at, stripe_subscription_id')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (error) throw error;

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

  const { data, error } = await query;
  if (error) throw error;
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
  const [{ data: rows, error: rowsErr }, { data: guest, error: guestErr }] = await Promise.all([
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
  if (rowsErr) throw rowsErr;
  if (guestErr) throw guestErr;

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
  const [{ data: events, error: eventsErr }, { data: members, error: membersErr }] = await Promise.all([
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
  if (eventsErr) throw eventsErr;
  if (membersErr) throw membersErr;

  return {
    events: (events ?? []).map((e) => ({ id: e.id, name: e.name })),
    actors: (members ?? [])
      .map((m) => ({ id: m.user_id, name: m.user_profiles?.full_name ?? 'Onbekend' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'nl')),
  };
}

// ── Request links + influencers (Requests-epic F1, 86ey21vjt) ─────────────────
// Per-influencer/per-channel request links on an event, plus the venue influencer
// roster. RLS is the boundary: admin (venue) + organizer (own event) read/manage
// links, admin manages influencers, finance reads, staff/door see nothing — an
// out-of-scope caller simply gets []. Names are resolved in second round-trips
// (no FK-embed guessing), mirroring fetchQuotaRequests.

export interface PoRequestLink {
  id: string;
  eventId: string;
  /** Public URL path segment: the link lives at {origin}/e/{slug}. */
  slug: string;
  /** The event's legacy landing link — pinned first; its on/off is the event-level
   *  master toggle (events.landing_active), not this row's `active`. */
  isDefault: boolean;
  active: boolean;
  autoApprove: boolean;
  influencerId: string | null;
  /** Resolved influencer display name; null for label-only / default links. */
  influencerName: string | null;
  label: string | null;
  tierId: string | null;
  maxHeadcount: number | null;
  expiresAt: string | null;
  createdAt: string;
  // Funnel numbers, aggregated client-side from batched reads.
  /** Total landing pageviews (sum of the daily buckets). */
  views: number;
  /** Total requests submitted through the link (any status). */
  requests: number;
  /** Requests that made the list (status approved, manual or auto). */
  approved: number;
  /** Approved HEADCOUNT on the guest list via this link: sum of 1 + plus_ones
   *  over non-removed guests — what max_headcount caps. */
  approvedHeads: number;
  /** Checked-in HEADCOUNT via this link — same funnel step Promo shows (M14). */
  checkedInHeads: number;
}

/**
 * One event's request links (archived excluded) with their funnel numbers —
 * views / requests / approved / approved heads — via four batched reads (links,
 * pageview buckets, requests, guests), never per-link queries. Default link
 * first, then oldest-first.
 */
export async function fetchRequestLinks(client: Client, eventId: string): Promise<PoRequestLink[]> {
  const { data: links, error: linksErr } = await client
    .from('request_links')
    .select(
      'id, event_id, slug, is_default, active, auto_approve, influencer_id, label, tier_id, max_headcount, expires_at, created_at'
    )
    .eq('event_id', eventId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (linksErr) throw linksErr;

  const rows = links ?? [];
  if (rows.length === 0) return [];
  const linkIds = rows.map((l) => l.id);
  const infIds = [...new Set(rows.map((l) => l.influencer_id).filter((x): x is string => !!x))];

  const [influencersRes, pageviewsRes, requestsRes, guests] = await Promise.all([
    infIds.length
      ? client.from('influencers').select('id, name').in('id', infIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[], error: null }),
    client
      .from('request_link_pageviews_daily')
      .select('request_link_id, views')
      .in('request_link_id', linkIds),
    client
      .from('guest_requests')
      .select('request_link_id, status')
      .eq('event_id', eventId)
      .not('request_link_id', 'is', null),
    // Ranged: a 1500-guest event would truncate the headcount at PostgREST's
    // 1000-row cap. `.order('id')` keys the paging (same as fetchTiersWithUsage).
    fetchAllRanged<Pick<Tables['guests']['Row'], 'request_link_id' | 'plus_ones' | 'status'>>((from, to) =>
      client
        .from('guests')
        .select('request_link_id, plus_ones, status')
        .eq('event_id', eventId)
        .not('request_link_id', 'is', null)
        .order('id')
        .range(from, to)
    ),
  ]);
  if (influencersRes.error) throw influencersRes.error;
  if (pageviewsRes.error) throw pageviewsRes.error;
  if (requestsRes.error) throw requestsRes.error;
  const influencers = influencersRes.data ?? [];
  const pageviews = pageviewsRes.data ?? [];
  const requests = requestsRes.data ?? [];

  const nameById = new Map(influencers.map((i) => [i.id, i.name]));
  const viewsByLink = new Map<string, number>();
  for (const p of pageviews) {
    viewsByLink.set(p.request_link_id, (viewsByLink.get(p.request_link_id) ?? 0) + p.views);
  }
  const requestsByLink = new Map<string, number>();
  const approvedByLink = new Map<string, number>();
  for (const r of requests) {
    if (!r.request_link_id) continue;
    requestsByLink.set(r.request_link_id, (requestsByLink.get(r.request_link_id) ?? 0) + 1);
    if (r.status === 'approved') {
      approvedByLink.set(r.request_link_id, (approvedByLink.get(r.request_link_id) ?? 0) + 1);
    }
  }
  const headsByLink = new Map<string, number>();
  const checkedInByLink = new Map<string, number>();
  for (const g of guests) {
    if (!g.request_link_id || g.status === 'removed') continue;
    headsByLink.set(g.request_link_id, (headsByLink.get(g.request_link_id) ?? 0) + 1 + g.plus_ones);
    if (g.status === 'checked_in') {
      checkedInByLink.set(g.request_link_id, (checkedInByLink.get(g.request_link_id) ?? 0) + 1 + g.plus_ones);
    }
  }

  return rows
    .map((l) => ({
      id: l.id,
      eventId: l.event_id,
      slug: l.slug,
      isDefault: l.is_default,
      active: l.active,
      autoApprove: l.auto_approve,
      influencerId: l.influencer_id,
      influencerName: l.influencer_id ? nameById.get(l.influencer_id) ?? null : null,
      label: l.label,
      tierId: l.tier_id,
      maxHeadcount: l.max_headcount,
      expiresAt: l.expires_at,
      createdAt: l.created_at,
      views: viewsByLink.get(l.id) ?? 0,
      requests: requestsByLink.get(l.id) ?? 0,
      approved: approvedByLink.get(l.id) ?? 0,
      approvedHeads: headsByLink.get(l.id) ?? 0,
      checkedInHeads: checkedInByLink.get(l.id) ?? 0,
    }))
    .sort((a, b) => (a.isDefault === b.isDefault ? a.createdAt.localeCompare(b.createdAt) : a.isDefault ? -1 : 1));
}

/** A lean venue-wide link option (the approvals link-filter sheet): id + owning
 *  event + resolved display label. Default links resolve to a null label. */
export interface PoLinkOption {
  id: string;
  eventId: string;
  isDefault: boolean;
  /** Influencer name ?? label; null for the default link. */
  label: string | null;
}

/**
 * Every non-archived link at a venue (lean — no funnel numbers). `request_links`
 * already carries `venue_id`, so this never needed the eventIds indirection
 * (SCALE-5) — one venue_id, no `usePoEvents()` dependency at all.
 */
export async function fetchVenueRequestLinks(client: Client, venueId: string): Promise<PoLinkOption[]> {
  const { data, error } = await client
    .from('request_links')
    .select('id, event_id, is_default, label, influencer_id')
    .eq('venue_id', venueId)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const infIds = [...new Set(rows.map((l) => l.influencer_id).filter((x): x is string => !!x))];
  const infRes = infIds.length
    ? await client.from('influencers').select('id, name').in('id', infIds)
    : { data: [] as { id: string; name: string }[], error: null };
  if (infRes.error) throw infRes.error;
  const influencers = infRes.data ?? [];
  const nameById = new Map(influencers.map((i) => [i.id, i.name]));
  return rows.map((l) => ({
    id: l.id,
    eventId: l.event_id,
    isDefault: l.is_default,
    label: (l.influencer_id ? nameById.get(l.influencer_id) : null) ?? l.label ?? null,
  }));
}

export interface PoInfluencer {
  id: string;
  name: string;
  handle: string | null;
  notes: string | null;
  /** Non-archived request links attached to this influencer (venue-wide). */
  linkCount: number;
  /** A stats-page token is stamped (only its sha256 is stored — the URL itself
   *  is shown once at mint time, F2). Drives Create vs Renew in the edit sheet. */
  hasStatsToken: boolean;
}

/** The venue's influencer roster (non-archived), name-sorted, with per-influencer
 *  link counts from one extra batched read. Admin/organizer/finance read (RLS). */
export async function fetchVenueInfluencers(client: Client, venueId: string): Promise<PoInfluencer[]> {
  const [{ data: influencers, error: influencersErr }, { data: links, error: linksErr }] = await Promise.all([
    client
      .from('influencers')
      .select('id, name, handle, notes, stats_token_hash')
      .eq('venue_id', venueId)
      .is('archived_at', null)
      .order('name'),
    client
      .from('request_links')
      .select('influencer_id')
      .eq('venue_id', venueId)
      .is('archived_at', null)
      .not('influencer_id', 'is', null),
  ]);
  if (influencersErr) throw influencersErr;
  if (linksErr) throw linksErr;

  const counts = new Map<string, number>();
  for (const l of links ?? []) {
    if (!l.influencer_id) continue;
    counts.set(l.influencer_id, (counts.get(l.influencer_id) ?? 0) + 1);
  }
  return (influencers ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    handle: i.handle,
    notes: i.notes,
    linkCount: counts.get(i.id) ?? 0,
    hasStatsToken: i.stats_token_hash != null,
  }));
}

// ── Promotion dashboard (Requests-epic F2, 86ey6b3fe — S15) ───────────────────
// Three RPC-backed reads: the per-event link funnel (overview tiles + section 2),
// the venue-wide influencer leaderboard, and the label-only link funnel. The
// functions self-guard on role (admin/finance/organizer) and RLS bounds the rest;
// an out-of-scope caller gets []. Errors throw so React Query surfaces isError.

/** The shared views → requests → approved → checked-in funnel numbers. */
export interface PoFunnel {
  views: number;
  requests: number;
  approvedHeads: number;
  checkedInHeads: number;
}

export interface PoLinkFunnelRow extends PoFunnel {
  linkId: string;
  slug: string;
  isDefault: boolean;
  label: string | null;
  influencerId: string | null;
  influencerName: string | null;
  active: boolean;
  autoApprove: boolean;
  maxHeadcount: number | null;
  expiresAt: string | null;
}

/** Every request link on one event with its full funnel (event_link_funnel). */
export async function fetchEventLinkFunnel(client: Client, eventId: string): Promise<PoLinkFunnelRow[]> {
  const { data, error } = await client.rpc('event_link_funnel', { p_event_id: eventId });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    linkId: r.link_id,
    slug: r.slug,
    isDefault: r.is_default,
    label: r.label ?? null,
    influencerId: r.influencer_id ?? null,
    influencerName: r.influencer_name ?? null,
    active: r.active,
    autoApprove: r.auto_approve,
    maxHeadcount: r.max_headcount ?? null,
    expiresAt: r.expires_at ?? null,
    views: r.views,
    requests: r.requests,
    approvedHeads: r.approved_heads,
    checkedInHeads: r.checked_in_heads,
  }));
}

export interface PoLeaderboardRow extends PoFunnel {
  influencerId: string;
  name: string;
  handle: string | null;
  linksCount: number;
  eventsCount: number;
}

/** The venue-wide influencer leaderboard (checked-in desc), optionally bounded to
 *  a from/to window. The RPC's influencer-less bucket row is skipped — label-only
 *  links get their own section via fetchVenueLabelFunnel. */
export async function fetchInfluencerLeaderboard(
  client: Client,
  venueId: string,
  fromIso: string | null
): Promise<PoLeaderboardRow[]> {
  const { data, error } = await client.rpc('venue_influencer_leaderboard', {
    p_venue_id: venueId,
    ...(fromIso ? { p_from: fromIso } : {}),
  });
  if (error) throw error;
  return (data ?? [])
    .filter((r) => r.influencer_id != null)
    .map((r) => ({
      influencerId: r.influencer_id,
      name: r.influencer_name,
      handle: r.handle ?? null,
      linksCount: r.links_count,
      eventsCount: r.events_count,
      views: r.views,
      requests: r.requests,
      approvedHeads: r.approved_heads,
      checkedInHeads: r.checked_in_heads,
    }));
}

export interface PoLabelFunnelRow extends PoFunnel {
  linkId: string;
  label: string | null;
  isDefault: boolean;
  eventId: string;
  eventName: string;
}

/** Label-only (unattributed) links across the venue, with their funnels. */
export async function fetchVenueLabelFunnel(
  client: Client,
  venueId: string,
  fromIso: string | null
): Promise<PoLabelFunnelRow[]> {
  const { data, error } = await client.rpc('venue_label_link_funnel', {
    p_venue_id: venueId,
    ...(fromIso ? { p_from: fromIso } : {}),
  });
  if (error) throw error;
  return (data ?? []).map((r) => ({
    linkId: r.link_id,
    label: r.label ?? null,
    isDefault: r.is_default,
    eventId: r.event_id,
    eventName: r.event_name,
    views: r.views,
    requests: r.requests,
    approvedHeads: r.approved_heads,
    checkedInHeads: r.checked_in_heads,
  }));
}
