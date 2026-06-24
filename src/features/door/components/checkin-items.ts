/**
 * Pure flattening for the door check-in list (STAP 3.5b · #1a). The list has four
 * sections with dividers (Onderweg / PARTLY INSIDE / INSIDE / REFUSED). To
 * virtualize it we collapse the *visible* set into ONE tagged array — a header row
 * or a guest/refused row per item — so a single `useVirtualizer` windows the lot.
 *
 * All section logic lives here (not in the component) so it's unit-testable at
 * 1500 guests without React: the Beide/Onderweg/Ingecheckt filter, the partial-
 * binnen split, the refused-section visibility, and the counts shown on dividers.
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
  /** Guests visible under the active filter (excl. refused) — empty-state pivot. */
  visibleCount: number;
  /** matched active + matched refused — drives the "N found" search count. */
  matchedCount: number;
  /** True when the REFUSED section is rendered (search or Beide/Ingecheckt). */
  showRefused: boolean;
}

/**
 * Build the flattened, virtualizable item list for the current view + filter +
 * query. Header rows are emitted only for non-empty sections; a guest is in
 * exactly one of waiting / partial / fullyIn. Order is stable: Onderweg →
 * PARTLY INSIDE → INSIDE → REFUSED (mirrors the original JSX).
 */
export function flattenCheckInItems(
  guests: DoorGuest[],
  refusedGuests: DoorGuest[],
  filter: Filter,
  query: string,
): FlattenResult {
  const matched = filterBySearch(guests, query);
  const waiting = matched.filter((g) => !g.inside);
  const partial = matched.filter((g) => g.inside && partsLeft(g) > 0);
  const fullyIn = matched.filter((g) => g.inside && partsLeft(g) === 0);

  // Partial is shown under every filter (it's both onderweg én binnen); waiting
  // only under Beide/Onderweg, fully-in only under Beide/Ingecheckt.
  const showWaiting = filter === 'both' || filter === 'wait';
  const showFull = filter === 'both' || filter === 'in';

  const matchedRefused = filterBySearch(refusedGuests, query);
  const showRefused = matchedRefused.length > 0 && (filter === 'both' || filter === 'in' || query.trim() !== '');

  const items: CheckInItem[] = [];
  if (showWaiting) {
    for (const g of waiting) items.push({ type: 'guest', key: g.id, g });
  }
  if (partial.length > 0) {
    items.push({ type: 'header', key: 'h-partial', label: `PARTLY INSIDE · ${partial.length}` });
    for (const g of partial) items.push({ type: 'guest', key: g.id, g });
  }
  if (showFull && fullyIn.length > 0) {
    items.push({ type: 'header', key: 'h-full', label: `INSIDE · ${fullyIn.length}` });
    for (const g of fullyIn) items.push({ type: 'guest', key: g.id, g });
  }
  if (showRefused) {
    items.push({ type: 'header', key: 'h-refused', label: `REFUSED · ${matchedRefused.length}` });
    for (const g of matchedRefused) items.push({ type: 'refused', key: `ref-${g.id}`, g });
  }

  const visibleCount = (showWaiting ? waiting.length : 0) + partial.length + (showFull ? fullyIn.length : 0);
  return {
    items,
    visibleCount,
    matchedCount: matched.length + matchedRefused.length,
    showRefused,
  };
}
