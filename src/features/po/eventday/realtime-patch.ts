/**
 * Patch the desktop cockpit's caches from a realtime payload instead of
 * re-downloading them (Snelheid P2, perf audit finding 10) — the same idea as
 * the mobile door's `onRealtimeCheckIn`: the row that changed is in the
 * payload, so the list only needs that row swapped.
 *
 * Pure functions over the two cockpit caches (`poKeys.guests` = po `Guest[]`,
 * `poKeys.arrivals` = guest id → active check-in). A guest row is rebuilt
 * through the ONE guests adapter, `toPoGuest` (CLAUDE.md: one adapter per
 * entity), from the payload's full row plus the provenance the cache already
 * holds — so a column added to the adapter can never drift here. Each guest
 * patch says when it can NOT be done from the payload alone — a row the cache
 * has never seen (an insert, or a status that newly puts it on the list) needs
 * the embeds the payload lacks (who added it, via which link), a tier the tiers
 * cache doesn't know needs its name/colour, and a partial payload can't fill a
 * row — and the caller falls back to the throttled refetch for exactly those.
 */
import type { Guest, Tier } from '@/lib/po/types';
import type { Tables } from '@/lib/database.types';
import type { CheckinArrival, PoGuestRow } from '../queries';
import { tierRole, toPoGuest } from '../adapters';

/** A `guests` row as a postgres_changes payload carries it (UPDATE/INSERT `new`). */
export type RealtimeGuestRow = Partial<Tables<'guests'>> & { id: string };
/** A `check_ins` row as a postgres_changes payload carries it. */
export type RealtimeCheckInRow = Pick<Tables<'check_ins'>, 'id' | 'guest_id' | 'plus_ones_arrived' | 'checked_at' | 'voided_at'> &
  Partial<Pick<Tables<'check_ins'>, 'event_id'>>;

/** The statuses `fetchGuests` lists (ON_LIST + refused); anything else leaves the list. */
const LISTED = new Set(['approved', 'checked_in', 'refused']);

/** The columns `toPoGuest` reads off a guests row; a payload missing one can't rebuild the row. */
const ADAPTER_COLUMNS = [
  'full_name', 'plus_ones', 'status', 'tier_id', 'note', 'note_priority', 'note_acknowledged_at',
  'created_at', 'contact_id', 'anonymized_at', 'source',
] as const;

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
  if (ADAPTER_COLUMNS.some((c) => !(c in row))) return { next: prev, needsRefetch: true };

  const cur = prev[idx];
  const tier = tiers?.find((t) => t.id === row.tier_id);
  if (row.tier_id && !tier) return { next: prev, needsRefetch: true };

  // Provenance (who added it, via which link) never changes on an update and
  // isn't in the payload: carry the cached values into the adapter.
  const merged = {
    ...(row as unknown as PoGuestRow),
    addedByName: cur.addedByName ?? null,
    addedByKind: cur.addedByKind ?? null,
    linkLabel: cur.linkLabel ?? null,
  } as PoGuestRow;
  const patched = toPoGuest(merged, {
    role: tierRole(tier?.name ?? '').role,
    tierName: tier?.name,
    tierColor: tier?.color,
    eventId: cur.eventId,
    eventName: cur.eventName,
  });
  const next = prev.slice();
  next[idx] = patched;
  return { next, needsRefetch: false };
}

/**
 * One check_ins change → the arrivals map: an active row sets the guest's
 * arrival, a void clears it — but only when it is the very check-in the cache
 * holds (`check_ins.guest_id` is unique, so the row id is stable across void
 * and revive). A void never clears an optimistic arrival (no id yet) or a
 * different row.
 */
export function patchArrivalsFromCheckIn(
  prev: Map<string, CheckinArrival> | undefined,
  row: RealtimeCheckInRow,
): Map<string, CheckinArrival> | undefined {
  if (!prev) return prev;
  const next = new Map(prev);
  if (row.voided_at == null) {
    next.set(row.guest_id, { arrived: row.plus_ones_arrived, at: row.checked_at, id: row.id });
  } else if (next.get(row.guest_id)?.id === row.id) {
    next.delete(row.guest_id);
  } else {
    return prev;
  }
  return next;
}
