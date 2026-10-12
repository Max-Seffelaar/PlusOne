/**
 * Patch the desktop cockpit's caches from a realtime payload instead of
 * re-downloading them (Snelheid P2, perf audit finding 10) — the same idea as
 * the mobile door's `onRealtimeCheckIn`: the row that changed is in the
 * payload, so the list only needs that row swapped.
 *
 * Pure functions over the two cockpit caches (`poKeys.guests` = po `Guest[]`,
 * `poKeys.arrivals` = guest id → active check-in). Each guest patch says when it
 * can NOT be done from the payload alone — a row the cache has never seen (an
 * insert, or a status that newly puts it on the list) needs the embeds the
 * payload lacks (who added it, via which link), and a tier the tiers cache
 * doesn't know needs its name/colour — and the caller falls back to the
 * throttled refetch for exactly those.
 */
import type { Guest, Tier } from '@/lib/po/types';
import type { Tables } from '@/lib/database.types';
import type { CheckinArrival } from '../queries';
import { guestStatusToPo, notePriorityToFlag, tierRole } from '../adapters';

/** A `guests` row as a postgres_changes payload carries it (UPDATE/INSERT `new`). */
export type RealtimeGuestRow = Partial<Tables<'guests'>> & { id: string };
/** A `check_ins` row as a postgres_changes payload carries it. */
export type RealtimeCheckInRow = Pick<Tables<'check_ins'>, 'id' | 'guest_id' | 'plus_ones_arrived' | 'checked_at' | 'voided_at'>;

/** The statuses `fetchGuests` lists (ON_LIST + refused); anything else leaves the list. */
const LISTED = new Set(['approved', 'checked_in', 'refused']);

export interface GuestPatch {
  next: Guest[] | undefined;
  /** The payload alone can't produce the row: refetch the list (throttled). */
  needsRefetch: boolean;
}

export function patchGuestsFromRow(
  prev: Guest[] | undefined,
  row: RealtimeGuestRow,
  tiers: readonly Tier[] | undefined,
): GuestPatch {
  // Nothing cached (cockpit not mounted, or still loading): the query fetches
  // the current list itself when it runs.
  if (!prev) return { next: prev, needsRefetch: false };
  const idx = prev.findIndex((g) => g.id === row.id);
  const listed = row.status === undefined ? idx >= 0 : LISTED.has(row.status);

  if (!listed) {
    // Removed / pending / denied: off the list, exactly like a refetch would.
    return idx >= 0 ? { next: prev.filter((g) => g.id !== row.id), needsRefetch: false } : { next: prev, needsRefetch: false };
  }
  if (idx < 0) return { next: prev, needsRefetch: true };

  const cur = prev[idx];
  const patched: Guest = { ...cur };
  if (row.full_name !== undefined) patched.name = row.full_name;
  if (row.plus_ones !== undefined) patched.plus = row.plus_ones;
  if (row.status !== undefined) patched.status = guestStatusToPo(row.status);
  if (row.note !== undefined) patched.note = row.note ?? '';
  if (row.note_priority !== undefined) patched.flag = notePriorityToFlag(row.note_priority);
  if (row.note_acknowledged_at !== undefined) patched.noteAcknowledged = row.note_acknowledged_at != null;
  if (row.contact_id !== undefined) patched.contactId = row.contact_id;
  if (row.anonymized_at !== undefined) patched.anonymized = row.anonymized_at != null;
  if (row.tier_id !== undefined && row.tier_id !== cur.tierId) {
    const tier = tiers?.find((t) => t.id === row.tier_id);
    if (!tier) return { next: prev, needsRefetch: true };
    patched.tierId = tier.id;
    patched.tierName = tier.name;
    patched.tierColor = tier.color;
    patched.role = tierRole(tier.name).role;
  }
  const next = prev.slice();
  next[idx] = patched;
  return { next, needsRefetch: false };
}

/** One check_ins change → the arrivals map (an active row sets, a voided one clears). */
export function patchArrivalsFromCheckIn(
  prev: Map<string, CheckinArrival> | undefined,
  row: RealtimeCheckInRow,
): Map<string, CheckinArrival> | undefined {
  if (!prev) return prev;
  const next = new Map(prev);
  if (row.voided_at == null) {
    next.set(row.guest_id, { arrived: row.plus_ones_arrived, at: row.checked_at, id: row.id });
  } else if (next.get(row.guest_id)?.id === row.id || next.get(row.guest_id)?.id === undefined) {
    // Only clear when the void hits the check-in the cache holds (or an
    // optimistic one without an id); a stale void of an older row must not
    // erase a newer revival.
    next.delete(row.guest_id);
  }
  return next;
}
