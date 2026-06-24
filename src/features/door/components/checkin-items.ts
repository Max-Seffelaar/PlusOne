/**
 * Pure flattening for the door check-in list (feedback Joeri, 24 jun 2026).
 *
 * One FLAT alphabetical list: a checked-in guest keeps its alphabetical position
 * and is only dimmed (the row styling), instead of sinking under an "AL BINNEN"
 * divider. Refused guests stay split out as a single trailing group (their row
 * has a different action — undo-refusal). The Beide/Onderweg/Ingecheckt segment
 * and an optional per-tier filter are folded in as row predicates here, so the
 * whole thing is one tagged array a single `useVirtualizer` can window — and it's
 * unit-testable at 1500 guests without React.
 */
import type { DoorGuest } from '../model';
import { filterBySearch } from './fuzzy';

export type Filter = 'both' | 'wait' | 'in';

export type CheckInItem =
  | { type: 'header'; key: string; label: string }
  | { type: 'guest'; key: string; g: DoorGuest }
  | { type: 'refused'; key: string; g: DoorGuest };

/** Plus-ones of the party still outside (only meaningful once the guest is in). */
export function partsLeft(g: DoorGuest): number {
  return g.inside ? Math.max(0, g.plus - (g.arrived ?? 0)) : 0;
}

export interface FlattenResult {
  items: CheckInItem[];
  /** Guests visible under the active filters (excl. refused) — empty-state pivot. */
  visibleCount: number;
  /** matched active + matched refused — drives the "N found" search count. */
  matchedCount: number;
  /** True when the REFUSED group is rendered (search or Beide/Ingecheckt). */
  showRefused: boolean;
}

const byName = (a: DoorGuest, b: DoorGuest): number =>
  a.name.localeCompare(b.name, 'nl', { sensitivity: 'base' });

/**
 * Build the flattened, virtualizable item list for the current filter + tier
 * filter + query. The active guests are ONE alphabetical list (checked-in guests
 * dim in place); refused matches follow under a single divider. The segment
 * filter keeps the prototype's semantics — a partially-inside guest counts as
 * both "onderweg" (people still outside) and "inside".
 */
export function flattenCheckInItems(
  guests: DoorGuest[],
  refusedGuests: DoorGuest[],
  filter: Filter,
  query: string,
  tierFilter: Set<string> = new Set(),
): FlattenResult {
  const tierOk = (g: DoorGuest): boolean => tierFilter.size === 0 || tierFilter.has(g.tierId);
  const stateOk = (g: DoorGuest): boolean =>
    filter === 'both'
      ? true
      : filter === 'in'
        ? g.inside
        : // 'wait': still on the way OR a partly-inside party (people still outside).
          !g.inside || partsLeft(g) > 0;

  const matched = filterBySearch(guests, query).filter(tierOk);
  const visible = matched.filter(stateOk).sort(byName);

  const matchedRefused = filterBySearch(refusedGuests, query).filter(tierOk).sort(byName);
  // Refused shows under Beide/Ingecheckt or while searching (mirrors the original).
  const showRefused =
    matchedRefused.length > 0 && (filter === 'both' || filter === 'in' || query.trim() !== '');

  const items: CheckInItem[] = [];
  for (const g of visible) items.push({ type: 'guest', key: g.id, g });
  if (showRefused) {
    items.push({ type: 'header', key: 'h-refused', label: `REFUSED · ${matchedRefused.length}` });
    for (const g of matchedRefused) items.push({ type: 'refused', key: `ref-${g.id}`, g });
  }

  return {
    items,
    visibleCount: visible.length,
    matchedCount: matched.length + matchedRefused.length,
    showRefused,
  };
}
