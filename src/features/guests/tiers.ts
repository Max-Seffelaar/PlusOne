import type { QuickAddTier } from './quick-add-parser';

/**
 * Master switch for the tier ALIAS user interface (ADE UX round, item E, 17/9/2026).
 *
 * Why it is off: aliases were built for power users, but every venue we onboard now
 * meets them as an unexplained extra field in the three create-a-tier forms. They add
 * friction for a payoff almost nobody uses yet, so the UI is hidden until the feature
 * comes back with a better design and more users behind it.
 *
 * What stays intact: the `guest_tiers.aliases` column, everything already stored in it,
 * the server actions/schemas, and the quick-add parser — which matches tier NAMES as
 * well as aliases (`buildAliasIndex` in `quick-add-parser.ts`), so "Juri +2 vip" keeps
 * working with the UI hidden. The forms therefore never overwrite stored aliases:
 * with the flag off, create sends `aliases: []` and update omits the field entirely.
 *
 * How to re-enable: flip this to `true`. Every alias render site reads this constant
 * (`screens/events/tiers.tsx`, `screens/guests/_shared.tsx`, `screens/templates.tsx`).
 *
 * Typed as `boolean` on purpose: a literal `false` would narrow every render site to
 * dead code, which hides type errors in the branch we intend to switch back on.
 */
export const TIER_ALIASES_UI: boolean = false;

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
