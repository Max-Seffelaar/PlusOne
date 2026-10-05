// Data collection for the venue data export (legal v0.3 E1, plan §3 E1).
//
// Every read goes through the CALLER'S user-scoped client, so RLS is the
// boundary on every row (CLAUDE.md #1) — the action only adds the venue / event
// filter on top. Scale rules (CLAUDE.md "Scale & front-end discipline"):
//   * every table is filtered on its own `venue_id` (all four carry it) — never
//     an `.in()` over the venue's event ids;
//   * reads are paged per 1 000 rows via `.range()` with a unique `id` order;
//   * above EXPORT_MAX_ROWS rows in one table the export stops with
//     ExportTooLargeError ("export per event") instead of a half file.
// The only `.in()` is the actor-name lookup: the distinct user ids that added a
// guest / decided a request / worked the door — a team-sized list, chunked to
// ≤120 ids anyway.
//
// Anonymised rows (#29) are exported as they are ("Guest #n", contact fields
// null): the venue sees they existed, but gets no PII back.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { chunkIds } from '@/lib/supabase/paging';
import { toCsv, type CsvValue } from './csv';
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE } from './schemas';

type Client = SupabaseClient<Database>;

export type ExportTable = 'guests' | 'contacts' | 'requests' | 'door';

export class ExportTooLargeError extends Error {
  constructor(readonly table: ExportTable) {
    super(`export: ${table} exceeds ${EXPORT_MAX_ROWS} rows`);
    this.name = 'ExportTooLargeError';
  }
}

export interface ExportCounts {
  guests: number;
  contacts: number;
  requests: number;
  door: number;
}

export interface ExportFiles {
  files: { name: string; csv: string }[];
  counts: ExportCounts;
}

type PageResult<T> = { data: T[] | null; error: unknown };

/**
 * Read every row of one query, 1 000 at a time. Throws ExportTooLargeError as
 * soon as the table holds more than EXPORT_MAX_ROWS rows — at most 51 page
 * fetches, so a huge venue fails fast instead of on the function timeout.
 */
export async function pageAll<T>(
  table: ExportTable,
  makePage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = EXPORT_PAGE_SIZE,
  maxRows = EXPORT_MAX_ROWS,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await makePage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (all.length > maxRows) throw new ExportTooLargeError(table);
    if (rows.length < pageSize) return all;
  }
}

/** First element of a PostgREST embed (to-one embeds may arrive as object or array). */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export const GUEST_HEADERS = [
  'event_name', 'event_date', 'full_name', 'email', 'phone', 'plus_ones', 'tier', 'status',
  'note', 'source', 'created_at', 'created_by', 'checked_in_at',
] as const;
export const CONTACT_HEADERS = [
  'full_name', 'email', 'phone', 'birthdate', 'preferred_role', 'note', 'marketing_opt_in',
  'created_at', 'last_seen_event',
] as const;
export const REQUEST_HEADERS = [
  'event_name', 'full_name', 'email', 'phone', 'plus_ones', 'motivation', 'marketing_opt_in',
  'status', 'decision_reason', 'decided_by', 'created_at', 'request_link_name',
] as const;
export const DOOR_HEADERS = [
  'event_name', 'guest_name', 'type', 'party_size', 'reason', 'acted_by', 'device_id',
  'created_at', 'voided_at',
] as const;

/**
 * Collect the four CSVs for a venue (eventId null) or one event of it. The
 * caller has already verified the session, the admin role and — for an event
 * scope — that the event belongs to the venue.
 */
export async function collectVenueExport(
  client: Client,
  venueId: string,
  eventId: string | null,
): Promise<ExportFiles> {
  // ── Lookups: events, tiers, request links (venue- or event-scoped) ─────────
  const events = await pageAll('guests', (from, to) => {
    let q = client.from('events').select('id, name, starts_at').eq('venue_id', venueId);
    if (eventId) q = q.eq('id', eventId);
    return q.order('id').range(from, to);
  });
  const eventById = new Map(events.map((e) => [e.id, e]));
  const eventName = (id: string): string => eventById.get(id)?.name ?? '';

  const tiers = await pageAll('guests', (from, to) => {
    let q = client.from('guest_tiers').select('id, name').eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });
  const tierName = new Map(tiers.map((t) => [t.id, t.name]));

  const links = await pageAll('requests', (from, to) => {
    let q = client.from('request_links').select('id, label, slug').eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });
  const linkName = new Map(links.map((l) => [l.id, l.label ?? l.slug]));

  // ── guests ──────────────────────────────────────────────────────────────────
  const guests = await pageAll('guests', (from, to) => {
    let q = client
      .from('guests')
      .select(
        'id, event_id, full_name, email, phone, plus_ones, tier_id, status, note, source, created_at, added_by, contact_id, check_ins(checked_at, voided_at)',
      )
      .eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });

  // ── contacts ────────────────────────────────────────────────────────────────
  // Venue scope: the whole address book. Event scope: the contacts with a guest
  // row on that event (embedded inner join, still filtered on contacts.venue_id).
  const contactCols = 'id, full_name, email, phone, birthdate, preferred_role, note, created_at';
  const contacts = await pageAll('contacts', (from, to) =>
    eventId
      ? client
          .from('contacts')
          .select(`${contactCols}, guests!inner(event_id)`)
          .eq('venue_id', venueId)
          .eq('guests.event_id', eventId)
          .order('id')
          .range(from, to)
      : client.from('contacts').select(contactCols).eq('venue_id', venueId).order('id').range(from, to),
  );

  // Decision 2: marketing opt-in per contact — the same SQL derivation the
  // contacts screen reads (latest matching request decides).
  const optIns = await pageAll('contacts', (from, to) =>
    client.rpc('contact_marketing_opt_ins', { p_venue_id: venueId }).range(from, to),
  );
  const optedIn = new Set(optIns.map((o) => o.contact_id));

  // ── requests ────────────────────────────────────────────────────────────────
  const requests = await pageAll('requests', (from, to) => {
    let q = client
      .from('guest_requests')
      .select(
        'id, event_id, full_name, email, phone, plus_ones, motivation, marketing_opt_in, status, decision_reason, decided_by, created_at, request_link_id',
      )
      .eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });

  // ── door: check-ins + refusals ──────────────────────────────────────────────
  const checkIns = await pageAll('door', (from, to) => {
    let q = client
      .from('check_ins')
      .select('id, event_id, plus_ones_arrived, checked_by, device_id, checked_at, voided_at, guests(full_name)')
      .eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });
  const refusals = await pageAll('door', (from, to) => {
    let q = client
      .from('refusals')
      .select('id, event_id, reason, refused_by, device_id, refused_at, guests(full_name)')
      .eq('venue_id', venueId);
    if (eventId) q = q.eq('event_id', eventId);
    return q.order('id').range(from, to);
  });
  if (checkIns.length + refusals.length > EXPORT_MAX_ROWS) throw new ExportTooLargeError('door');

  // ── Actor names (team-sized id list, chunked) ───────────────────────────────
  const actorIds = new Set<string>();
  for (const g of guests) if (g.added_by) actorIds.add(g.added_by);
  for (const r of requests) if (r.decided_by) actorIds.add(r.decided_by);
  for (const c of checkIns) actorIds.add(c.checked_by);
  for (const r of refusals) actorIds.add(r.refused_by);
  const actorName = new Map<string, string>();
  for (const chunk of chunkIds([...actorIds], 120)) {
    const { data, error } = await client.from('user_profiles').select('id, full_name').in('id', chunk);
    if (error) throw error;
    for (const p of data ?? []) actorName.set(p.id, p.full_name);
  }
  const actor = (id: string | null): string => (id ? (actorName.get(id) ?? id) : '');

  // ── Build rows ──────────────────────────────────────────────────────────────
  const lastSeen = new Map<string, { at: string; name: string }>();
  const guestRows: CsvValue[][] = guests.map((g) => {
    const ev = eventById.get(g.event_id);
    if (g.contact_id && ev && g.status !== 'removed') {
      const prev = lastSeen.get(g.contact_id);
      if (!prev || ev.starts_at > prev.at) lastSeen.set(g.contact_id, { at: ev.starts_at, name: ev.name });
    }
    // The generated types call this embed to-one; normalise either shape.
    const checks = [g.check_ins ?? []].flat() as { checked_at: string; voided_at: string | null }[];
    const active = checks
      .filter((c) => c.voided_at == null)
      .map((c) => c.checked_at)
      .sort()
      .pop();
    return [
      ev?.name ?? '', ev?.starts_at ?? '', g.full_name, g.email, g.phone, g.plus_ones,
      tierName.get(g.tier_id) ?? '', g.status, g.note, g.source, g.created_at, actor(g.added_by),
      active ?? null,
    ];
  });

  const contactRows: CsvValue[][] = contacts.map((c) => [
    c.full_name, c.email, c.phone, c.birthdate, c.preferred_role, c.note, optedIn.has(c.id),
    c.created_at, lastSeen.get(c.id)?.name ?? null,
  ]);

  const requestRows: CsvValue[][] = requests.map((r) => [
    eventName(r.event_id), r.full_name, r.email, r.phone, r.plus_ones, r.motivation, r.marketing_opt_in,
    r.status, r.decision_reason, actor(r.decided_by), r.created_at,
    r.request_link_id ? (linkName.get(r.request_link_id) ?? '') : '',
  ]);

  const door: { at: string; row: CsvValue[] }[] = [
    ...checkIns.map((c) => ({
      at: c.checked_at,
      row: [
        eventName(c.event_id), one(c.guests)?.full_name ?? '', 'check_in', 1 + c.plus_ones_arrived, null,
        actor(c.checked_by), c.device_id, c.checked_at, c.voided_at,
      ] as CsvValue[],
    })),
    ...refusals.map((r) => ({
      at: r.refused_at,
      row: [
        eventName(r.event_id), one(r.guests)?.full_name ?? '', 'refusal', null, r.reason,
        actor(r.refused_by), r.device_id, r.refused_at, null,
      ] as CsvValue[],
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  return {
    files: [
      { name: 'guests.csv', csv: toCsv(GUEST_HEADERS, guestRows) },
      { name: 'contacts.csv', csv: toCsv(CONTACT_HEADERS, contactRows) },
      { name: 'requests.csv', csv: toCsv(REQUEST_HEADERS, requestRows) },
      { name: 'door.csv', csv: toCsv(DOOR_HEADERS, door.map((d) => d.row)) },
    ],
    counts: {
      guests: guestRows.length,
      contacts: contactRows.length,
      requests: requestRows.length,
      door: door.length,
    },
  };
}
