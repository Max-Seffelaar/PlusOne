/**
 * Single source of truth for date/time display across the po surface + door.
 * Everything renders in the product's timezone (Europe/Amsterdam) regardless of
 * the viewing device (#26) — C28 was the door being the one surface that didn't;
 * this module is what keeps every OTHER surface from drifting the same way.
 */

export const TZ = 'Europe/Amsterdam';

/** Low-level pinned formatter — the escape hatch for a one-off options shape.
 *  Named `formatInTz` (not `fmt`) so it never shadows `@/lib/i18n`'s `fmt`
 *  (string-interpolation, unrelated) in files that need both. */
export function formatInTz(iso: string, opts: Intl.DateTimeFormatOptions, locale = 'en-GB'): string {
  return new Intl.DateTimeFormat(locale, { timeZone: TZ, ...opts }).format(new Date(iso));
}

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "23:14" (Amsterdam, 24h). */
export function formatTime(iso: string): string {
  return formatInTz(iso, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "16 Jul" (Amsterdam, no weekday). */
export function formatShortDate(iso: string): string {
  return formatInTz(iso, { day: 'numeric', month: 'short' }).replace('.', '');
}

/** "Sat 16 Jul" (Amsterdam). */
export function formatWeekdayDate(iso: string): string {
  return formatInTz(iso, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
}

/** "16 Jul 2026" (Amsterdam). */
export function formatLongDate(iso: string): string {
  return formatInTz(iso, { day: 'numeric', month: 'short', year: 'numeric' }).replace('.', '');
}

/** "Sat 16 Jul 2026" (Amsterdam) — the contact-profile per-event date label. */
export function formatWeekdayLongDate(iso: string): string {
  return formatInTz(iso, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).replace(/[.,]/g, '');
}

/** Capitalized "July 2026" (Amsterdam) — the Home month header. */
export function formatMonthYear(iso: string): string {
  return capitalize(formatInTz(iso, { month: 'long', year: 'numeric' }));
}

/** "16 Jul · 18:07" (Amsterdam) — a check-in instant needs the date alongside
 *  the time (not just "18:07") since an event can cross midnight (#26): without
 *  it, a guest who arrived just after 00:00 reads as earlier than one who
 *  arrived at 23:50 the same night. */
export function formatDateTime(iso: string): string {
  return `${formatShortDate(iso)} · ${formatTime(iso)}`;
}

/** A 15-min bucket / check-in instant → "23:30" (Amsterdam); '—' when absent. */
export function formatClock(iso: string | null): string {
  if (!iso) return '—';
  if (Number.isNaN(new Date(iso).getTime())) return '—';
  return formatTime(iso);
}

/** A date → "20 jun" (Amsterdam); '—' when absent (stats screens). */
export function formatDay(iso: string | null): string {
  if (!iso) return '—';
  if (Number.isNaN(new Date(iso).getTime())) return '—';
  return formatShortDate(iso);
}

/** "yyyy-mm-dd" (Amsterdam) for <input type=date> and calendar-day comparisons. */
export function toDateInput(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}
