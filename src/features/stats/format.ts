// Display helpers for the statistics screens. Times render in the product's TZ
// (Amsterdam) on the server so the value is stable through hydration and so a
// check-in at 01:00 reads at its real local hour (#26). Delegates to the
// canonical date module (FE-2) — re-exported here so existing importers of
// `@/features/stats/format` don't need to change.
export { formatClock, formatDay, toDateInput } from '@/features/po/format';

/** Numeric attendance percentage from the DB → "72%". */
export function formatPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}
