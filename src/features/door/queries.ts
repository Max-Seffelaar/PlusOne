/**
 * Door snapshot fetch (spec §4 point 1): on opening an event the whole list +
 * tiers + check-in status is downloaded in one go and cached to IndexedDB. One
 * query key (`['door', eventId]`) holds the entire offline snapshot, so realtime
 * patches and optimistic writes are simple `setQueryData` edits.
 *
 * Everything goes through the caller's USER-scoped client, so RLS decides what
 * is visible (a doorhost sees the venue's guests; check_ins/refusals are scoped
 * to those guests). Client-agnostic so the server page can prefetch with the
 * server client and hand it to the provider as initialData.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { resolveAllowUncheck } from '@/features/events/allow-uncheck';
import { fetchAllRanged } from '@/lib/supabase/paging';

export type GuestRow = Database['public']['Tables']['guests']['Row'];
export type TierRow = Database['public']['Tables']['guest_tiers']['Row'];
export type CheckInRow = Database['public']['Tables']['check_ins']['Row'];
export type RefusalRow = Database['public']['Tables']['refusals']['Row'];
export type EventStatus = Database['public']['Enums']['event_status'];

export interface DoorEventMeta {
  id: string;
  /** Denormalised venue scope, for optimistic check_in/refusal rows (the door
   *  knows its venue; venue_id is otherwise trigger-filled server-side). */
  venueId: string;
  name: string;
  venueName: string;
  status: EventStatus;
  listLocked: boolean;
  /** Effective "uitchecken toestaan" (event override -> venue default -> true, #3 / S1.1). */
  allowUncheck: boolean;
}

export interface DoorSnapshot {
  event: DoorEventMeta;
  guests: GuestRow[];
  tiers: TierRow[];
  checkIns: CheckInRow[];
  refusals: RefusalRow[];
  /** user_id → full_name, for "toegevoegd door" / "ingecheckt door". */
  profiles: Record<string, string>;
  fetchedAt: string;
}

export interface QuotaStatus {
  quota: number;
  consumed: number;
  remaining: number;
  exempt: boolean;
}

export function doorSnapshotKey(eventId: string): readonly ['door', string] {
  return ['door', eventId] as const;
}

type Client = SupabaseClient<Database>;

/**
 * The check_ins/refusals reads embed `guests!inner(event_id)` purely to filter by
 * event (no `guest_id` list — see fetchDoorSnapshot). The snapshot row types have
 * no `guests` field, so drop the embed before handing rows back. Generic over the
 * base row so one helper serves both tables.
 */
function stripEmbeddedGuests<T>(row: T & { guests: unknown }): T {
  const rest: Record<string, unknown> = { ...row };
  delete rest.guests;
  return rest as T;
}

export async function fetchDoorSnapshot(client: Client, eventId: string): Promise<DoorSnapshot> {
  const { data: event, error: eventError } = await client
    .from('events')
    .select('id, name, status, list_locked, allow_uncheck, venue_id')
    .eq('id', eventId)
    .single();
  if (eventError || !event) throw new Error(eventError?.message ?? 'Event not found');

  // All three event-wide reads are ranged: at a busy door (1500+ guests) a single
  // `.select()` truncates at PostgREST's max-rows (1000) and the door silently
  // loses ~third of the list. guests + check_ins + refusals each page to the end;
  // every ranged read carries a unique `.order('id')` tiebreaker so pages can't
  // overlap or skip. check_ins/refusals filter via an inner-join on the event
  // (mirrors fetchRecentCheckins) instead of a giant `.in('guest_id', …)` — that
  // id list would blow Kong's URI length at 1500 ids and over-return anyway.
  const [{ data: venue }, guestRows, { data: tiers }, checkIns, refusals] = await Promise.all([
    client.from('venues').select('name, allow_uncheck').eq('id', event.venue_id).maybeSingle(),
    fetchAllRanged<GuestRow>((from, to) =>
      client
        // Refused guests are fetched too so the door can show a "Geweigerd" lijst
        // and offer "ongedaan maken"; buildDoorView splits them out by status.
        .from('guests')
        .select('*')
        .eq('event_id', eventId)
        .in('status', ['approved', 'checked_in', 'refused'])
        .order('full_name')
        .order('id')
        .range(from, to),
    ),
    client.from('guest_tiers').select('*').eq('event_id', eventId).order('name'),
    fetchAllRanged<CheckInRow & { guests: unknown }>((from, to) =>
      client
        .from('check_ins')
        .select('*, guests!inner(event_id)')
        .eq('guests.event_id', eventId)
        .order('id')
        .range(from, to),
    ).then((rows) => rows.map(stripEmbeddedGuests)),
    fetchAllRanged<RefusalRow & { guests: unknown }>((from, to) =>
      client
        .from('refusals')
        .select('*, guests!inner(event_id)')
        .eq('guests.event_id', eventId)
        .order('id')
        .range(from, to),
    ).then((rows) => rows.map(stripEmbeddedGuests)),
  ]);

  // Names needed for the logboek + the current user (for optimistic check-ins).
  const ids = new Set<string>();
  for (const g of guestRows) {
    ids.add(g.added_by);
    if (g.note_acknowledged_by) ids.add(g.note_acknowledged_by);
  }
  for (const c of checkIns) ids.add(c.checked_by);
  const {
    data: { user },
  } = await client.auth.getUser();
  if (user) ids.add(user.id);

  const profileRows = ids.size
    ? (await client.from('user_profiles').select('id, full_name').in('id', [...ids])).data ?? []
    : [];

  return {
    event: {
      id: event.id,
      venueId: event.venue_id,
      name: event.name,
      venueName: venue?.name ?? '',
      status: event.status,
      listLocked: event.list_locked,
      allowUncheck: resolveAllowUncheck(event.allow_uncheck, venue?.allow_uncheck ?? true),
    },
    guests: guestRows,
    tiers: tiers ?? [],
    checkIns,
    refusals,
    profiles: Object.fromEntries(profileRows.map((p) => [p.id, p.full_name])),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchEventQuota(client: Client, eventId: string): Promise<QuotaStatus | null> {
  const { data } = await client.rpc('event_quota_status', { p_event_id: eventId }).maybeSingle();
  return data ?? null;
}
