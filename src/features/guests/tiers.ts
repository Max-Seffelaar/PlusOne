import type { QuickAddTier } from './quick-add-parser';

/**
 * The default tier for the quick-add (case a) and the "Regular" chip in the
 * ambiguous case (c). There is no is_default column on guest_tiers, so we pick
 * by convention: a tier literally named "Regular", else the first tier. The
 * organizer controls ordering/naming in tier management (fase 6).
 */
export function resolveDefaultTierId(tiers: QuickAddTier[]): string | null {
  if (tiers.length === 0) return null;
  const regular = tiers.find((t) => t.name.trim().toLowerCase() === 'regular');
  return (regular ?? tiers[0]).id;
}
