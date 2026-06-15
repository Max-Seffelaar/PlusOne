'use client';

/**
 * Live data for the mobile guest screens (Lijst, Guest, QuickAdd, BulkPaste).
 *
 * Reads go through the caller's USER-scoped browser client, so RLS is the
 * security boundary (staff see only their own guests; the door host sees the
 * venue's list). Writes go through the existing `'use server'` guest actions in
 * `src/features/guests/actions.ts` — this file never writes directly, it only
 * invalidates the cache after an action returns ok.
 *
 * The fetchers return the prototype view types from `src/lib/po/types.ts`, so the
 * polished screens consume them with their component API unchanged (CLAUDE.md
 * design rule: replace the data, preserve the screen). Pure row → view mappers
 * live alongside `live-map.ts`; the per-guest Logboek is built from `audit_log`
 * (decision #4: the audit log is the source of truth for who-did-what).
 *
 * Runs inside `PoLiveProvider` (already provides the QueryClient + useSession).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Database } from '@/lib/database.types';
import type { Guest, Role, Tier } from '@/lib/po/types';
import { resolveDefaultTierId } from '@/features/guests/tiers';
import {
  addGuest,
  addGuestsBulk,
  removeGuest,
  type ActionResult,
} from '@/features/guests/actions';
import type { AddGuestInput, BulkAddInput } from '@/features/guests/schemas';
import { toPoTier } from './live-map';

type Client = SupabaseClient<Database>;
type GuestRow = Database['public']['Tables']['guests']['Row'];
type CheckInRow = Database['public']['Tables']['check_ins']['Row'];
type TierRow = Database['public']['Tables']['guest_tiers']['Row'];
type AuditRow = Database['public']['Tables']['audit_log']['Row'];

const TZ = 'Europe/Amsterdam';

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso));
}

function fmtTime(iso: string): string {
  return new Intl.DateTimeFormat('nl-NL', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/**
 * The prototype's Role union is a fixed example set; real tiers are free-form
 * per event (#8). Map a tier name onto the closest Role for icon/colour purposes
 * only — mirrors `roleForTier` in live-map (kept local; that one is private).
 */
function roleForTier(name: string): Role {
  const n = name.toLowerCase();
  if (n.includes('vip')) return 'VIP';
  if (n.includes('access') || n.includes('backstage')) return 'All Access';
  if (n.includes('artist') || n.includes('dj') || n.includes('act')) return 'Artist';
  if (n.includes('pers') || n.includes('press') || n.includes('media')) return 'Pers';
  if (n.includes('crew') || n.includes('prod')) return 'Crew';
  return 'Gast';
}

function flagFor(priority: GuestRow['note_priority']): Guest['flag'] {
  if (priority === 'high') return 'high';
  if (priority === 'low') return 'low';
  return null;
}

/**
 * Map a guests row + its (optional) earliest check-in onto the prototype Guest
 * view type. The check-in row is the server truth for "binnen" — the door app's
 * local-first toggle still drives the live `usePo()` check-in state, this only
 * seeds the initial status for the list/detail. `pay` is honestly 'free' until
 * guest_tiers.door_price lands with billing (#34); never fake a paid state.
 */
export function toPoGuest(
  g: GuestRow,
  tier: TierRow | undefined,
  checkIn: CheckInRow | undefined,
  profiles: Record<string, string>,
): Guest {
  const isIn = g.status === 'checked_in' || checkIn != null;
  return {
    id: g.id,
    name: g.full_name,
    role: roleForTier(tier?.name ?? ''),
    pay: 'free', // TODO(#34): derive from tier.door_price once that column exists
    plus: g.plus_ones,
    note: g.note ?? '',
    flag: flagFor(g.note_priority),
    by: profiles[g.added_by] ?? 'Onbekend',
    addedAt: fmtDate(g.created_at),
    status: isIn ? 'in' : 'wait',
    at: checkIn ? fmtTime(checkIn.checked_at) : undefined,
    inBy: checkIn ? profiles[checkIn.checked_by] ?? 'Deur' : undefined,
  };
}

/** Earliest check-in per guest (the first arrival wins, decision #11). */
function indexCheckIns(rows: CheckInRow[]): Map<string, CheckInRow> {
  const map = new Map<string, CheckInRow>();
  for (const c of rows) {
    const prev = map.get(c.guest_id);
    if (!prev || c.checked_at < prev.checked_at) map.set(c.guest_id, c);
  }
  return map;
}

/**
 * All (RLS-visible) guests for an event, mapped to the prototype Guest[].
 * `removed` rows are dropped — soft delete hides them from the list (#21).
 */
export async function fetchEventGuests(client: Client, eventId: string): Promise<Guest[]> {
  const [{ data: guestRows }, { data: tierRows }] = await Promise.all([
    client
      .from('guests')
      .select('*')
      .eq('event_id', eventId)
      .neq('status', 'removed')
      .order('full_name'),
    client.from('guest_tiers').select('*').eq('event_id', eventId),
  ]);

  const rows = guestRows ?? [];
  const tierById = new Map((tierRows ?? []).map((t) => [t.id, t]));
  const guestIds = rows.map((g) => g.id);

  const { data: checkInRows } = guestIds.length
    ? await client.from('check_ins').select('*').in('guest_id', guestIds)
    : { data: [] as CheckInRow[] };
  const checkInByGuest = indexCheckIns(checkInRows ?? []);

  // Names for "toegevoegd door" / "ingecheckt door".
  const ids = new Set<string>();
  for (const g of rows) ids.add(g.added_by);
  for (const c of checkInRows ?? []) ids.add(c.checked_by);
  const { data: profileRows } = ids.size
    ? await client.from('user_profiles').select('id, full_name').in('id', [...ids])
    : { data: [] as { id: string; full_name: string }[] };
  const profiles = Object.fromEntries((profileRows ?? []).map((p) => [p.id, p.full_name]));

  return rows.map((g) =>
    toPoGuest(g, tierById.get(g.tier_id), checkInByGuest.get(g.id), profiles),
  );
}

/** One audited event in a guest's Logboek (decision #4), already NL-formatted. */
export interface GuestLogEntry {
  id: string;
  action: string;
  /** Dutch label for the action. */
  label: string;
  /** Actor name, or "Systeem" when the actor is unknown (anon/landing). */
  by: string;
  /** "20 jun · 23:14" style stamp. */
  when: string;
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Toegevoegd',
  update: 'Gegevens gewijzigd',
  tier_change: 'Tier gewijzigd',
  check_in: 'Ingecheckt',
  refuse: 'Geweigerd',
  delete: 'Van lijst verwijderd',
};

/**
 * The append-only audit trail for one guest, newest first. Built from
 * `audit_log` (RLS lets the venue's team read it), never reconstructed from app
 * state, so it survives offline replays and reflects exactly who did what (#4).
 */
export async function fetchGuestLog(client: Client, guestId: string): Promise<GuestLogEntry[]> {
  const { data: rows } = await client
    .from('audit_log')
    .select('id, action, actor_id, created_at')
    .eq('entity_type', 'guests')
    .eq('entity_id', guestId)
    .order('created_at', { ascending: false });

  const entries = (rows ?? []) as Pick<AuditRow, 'id' | 'action' | 'actor_id' | 'created_at'>[];
  const actorIds = [...new Set(entries.map((r) => r.actor_id).filter((v): v is string => Boolean(v)))];
  const { data: profileRows } = actorIds.length
    ? await client.from('user_profiles').select('id, full_name').in('id', actorIds)
    : { data: [] as { id: string; full_name: string }[] };
  const names = new Map((profileRows ?? []).map((p) => [p.id, p.full_name]));

  return entries.map((r) => ({
    id: r.id,
    action: r.action,
    label: ACTION_LABEL[r.action] ?? r.action,
    by: r.actor_id ? names.get(r.actor_id) ?? 'Onbekend' : 'Systeem',
    when: `${fmtDate(r.created_at)} · ${fmtTime(r.created_at)}`,
  }));
}


/** The caller's own quota for an event (#22/#31). `exempt` = admin/organizer. */
export interface PoQuota {
  quota: number;
  consumed: number;
  remaining: number;
  exempt: boolean;
}

export async function fetchEventQuota(
  client: Client,
  eventId: string,
): Promise<PoQuota | null> {
  const { data } = await client.rpc('event_quota_status', { p_event_id: eventId }).maybeSingle();
  return data ?? null;
}

/** Tiers for an event as the prototype Tier[], with the default flagged (#33). */
export async function fetchEventTiers(client: Client, eventId: string): Promise<Tier[]> {
  const { data: tierRows } = await client
    .from('guest_tiers')
    .select('*')
    .eq('event_id', eventId)
    .order('created_at');
  const rows = tierRows ?? [];
  const defaultId = resolveDefaultTierId(
    rows.map((t) => ({ id: t.id, name: t.name, aliases: t.aliases ?? [] })),
  );
  // `used` is not needed for the quick-add picker; the Tiers screen owns the
  // consumed counts (usePoTiers). Pass 0 here.
  return rows.map((t) => toPoTier(t, 0, t.id === defaultId));
}

// ── hooks ─────────────────────────────────────────────────────────────────────

function useBrowserClient(): Client {
  const [client] = useState(() => createClient());
  return client;
}

/** Live guest list for an event, mapped to the prototype Guest[]. */
export function useEventGuests(eventId: string | undefined): {
  guests: Guest[];
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: guests = [], isLoading } = useQuery({
    queryKey: ['po', 'guests', eventId],
    queryFn: () => (eventId ? fetchEventGuests(client, eventId) : Promise.resolve([])),
    enabled: Boolean(eventId),
  });
  return { guests, isLoading };
}

/** A single guest from the (cached) event list — no extra round-trip. */
export function useEventGuest(
  eventId: string | undefined,
  guestId: string | undefined,
): { guest: Guest | null; isLoading: boolean } {
  const { guests, isLoading } = useEventGuests(eventId);
  const guest = guestId ? guests.find((g) => g.id === guestId) ?? null : null;
  return { guest, isLoading };
}

/** The per-guest Logboek (audit trail), newest first. */
export function useGuestLog(guestId: string | undefined): {
  entries: GuestLogEntry[];
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['po', 'guest-log', guestId],
    queryFn: () => (guestId ? fetchGuestLog(client, guestId) : Promise.resolve([])),
    enabled: Boolean(guestId),
  });
  return { entries, isLoading };
}

/** Tiers for an event as the prototype Tier[] (for the quick-add/bulk picker). */
export function useEventTiers(eventId: string | undefined): {
  tiers: Tier[];
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: tiers = [], isLoading } = useQuery({
    queryKey: ['po', 'guest-tiers', eventId],
    queryFn: () => (eventId ? fetchEventTiers(client, eventId) : Promise.resolve([])),
    enabled: Boolean(eventId),
  });
  return { tiers, isLoading };
}

/** The caller's quota for an event (drives the quick-add "x van y over"). */
export function useEventQuota(eventId: string | undefined): {
  quota: PoQuota | null;
  isLoading: boolean;
} {
  const client = useBrowserClient();
  const { data: quota = null, isLoading } = useQuery({
    queryKey: ['po', 'guest-quota', eventId],
    queryFn: () => (eventId ? fetchEventQuota(client, eventId) : Promise.resolve(null)),
    enabled: Boolean(eventId),
  });
  return { quota, isLoading };
}

/**
 * Mutation wrappers around the existing server actions. Each invalidates the
 * guest list (and counts on the event/tier screens) on success, so the optimistic
 * "Net toegevoegd" UI in the screen stays the screen's concern while the cache
 * stays correct. They surface the action's MutationError unchanged.
 */
export function useGuestMutations(eventId: string | undefined): {
  add: (input: AddGuestInput) => Promise<ActionResult>;
  addBulk: (input: BulkAddInput) => Promise<ActionResult>;
  remove: (guestId: string) => Promise<ActionResult>;
  isPending: boolean;
} {
  const qc = useQueryClient();
  const invalidate = async (): Promise<void> => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['po', 'guests', eventId] }),
      // Event cards + tier usage show guest-derived counts; quota changes too.
      qc.invalidateQueries({ queryKey: ['po', 'events'] }),
      qc.invalidateQueries({ queryKey: ['po', 'tiers', eventId] }),
      qc.invalidateQueries({ queryKey: ['po', 'guest-quota', eventId] }),
    ]);
  };

  const addM = useMutation({
    mutationFn: (input: AddGuestInput) => addGuest(input),
    onSuccess: (res) => (res.ok ? invalidate() : undefined),
  });
  const bulkM = useMutation({
    mutationFn: (input: BulkAddInput) => addGuestsBulk(input),
    onSuccess: (res) => (res.ok ? invalidate() : undefined),
  });
  const removeM = useMutation({
    mutationFn: (guestId: string) => removeGuest(guestId),
    onSuccess: (res) => (res.ok ? invalidate() : undefined),
  });

  return {
    add: addM.mutateAsync,
    addBulk: bulkM.mutateAsync,
    remove: removeM.mutateAsync,
    isPending: addM.isPending || bulkM.isPending || removeM.isPending,
  };
}
