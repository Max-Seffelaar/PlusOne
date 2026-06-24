// Display helpers for the statistics screens. Times render in the product's TZ
// (Amsterdam) on the server so the value is stable through hydration and so a
// check-in at 01:00 reads at its real local hour (#26).

const NL_TZ = 'Europe/Amsterdam';

/** A 15-min bucket timestamp → "23:30" (Amsterdam). */
export function formatClock(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-GB', { timeZone: NL_TZ, hour: '2-digit', minute: '2-digit' });
}

/** A date → "20 jun" (Amsterdam). */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { timeZone: NL_TZ, day: 'numeric', month: 'short' });
}

/** Numeric attendance percentage from the DB → "72%". */
export function formatPct(value: number | null | undefined): string {
  if (value == null) return '—';
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

/** "date" form (yyyy-mm-dd) for <input type=date>, in Amsterdam TZ. */
export function toDateInput(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: NL_TZ });
}
