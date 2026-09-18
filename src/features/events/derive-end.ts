/**
 * Derive an event's end date/time from its start (ADE UX round, item C1).
 *
 * The house standard is "doors + 6 hours": a night that opens at 23:00 ends at
 * 05:00 the next morning. The form pre-fills the End fields with this until the
 * user touches one of them, so nobody has to type the obvious.
 *
 * The arithmetic is deliberately on the WALL CLOCK, not on an instant: "+6 h"
 * means the clock reads six hours later, which is what an operator writes on a
 * poster. That also makes the helper timezone- and DST-independent (a DST
 * changeover date derives exactly like any other date); the conversion to a real
 * instant happens later in `localInputToIso`.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

export interface DerivedEnd {
  endDateStr: string;
  endTimeStr: string;
}

const EMPTY: DerivedEnd = { endDateStr: '', endTimeStr: '' };

/**
 * @param dateStr start date, 'YYYY-MM-DD'
 * @param timeStr start (doors) time, 'HH:mm'
 * @param hours   how many hours the night runs (default 6)
 * @returns the end date/time in the same formats, or empty strings when either
 *          input is missing or unreadable.
 */
export function deriveEnd(dateStr: string, timeStr: string, hours = 6): DerivedEnd {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateStr ?? '').trim());
  const tm = /^(\d{1,2}):(\d{2})$/.exec((timeStr ?? '').trim());
  if (!d || !tm) return EMPTY;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return EMPTY;

  // Midday anchor so the day rollover below can never be disturbed by a DST
  // transition at midnight (exists in some zones) — we only use the date parts.
  const base = new Date(year, month - 1, day, 12, 0, 0, 0);
  if (base.getMonth() !== month - 1 || base.getDate() !== day) return EMPTY; // e.g. 31-02

  const total = hour * 60 + minute + Math.round(hours * 60);
  const dayShift = Math.floor(total / (24 * 60));
  const rest = ((total % (24 * 60)) + 24 * 60) % (24 * 60);

  base.setDate(base.getDate() + dayShift);

  return {
    endDateStr: `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`,
    endTimeStr: `${pad(Math.floor(rest / 60))}:${pad(rest % 60)}`,
  };
}
