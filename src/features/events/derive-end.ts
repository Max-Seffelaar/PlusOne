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

/** 'HH:mm' → minutes after midnight, or null when unreadable. */
function clockMinutes(timeStr: string): number | null {
  const tm = /^(\d{1,2}):(\d{2})$/.exec((timeStr ?? '').trim());
  if (!tm) return null;
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Events cross midnight (#26). When the user sets an end time at or before the
 * doors time while the end date is still the start date, the only sensible
 * reading is "the next morning": a night that opens at 23:00 and "ends at 04:00"
 * ends at 04:00 tomorrow. This returns the end date the form should hold after
 * that edit, instead of letting the save fail with "The end must be after the
 * start" (Joeri walkthrough, z8uq9m0hw3).
 *
 * Only that one case moves: a different end date, an end after the doors, or a
 * missing/unreadable field returns `endDateStr` unchanged. An end exactly at the
 * doors time rolls too (a 24-hour night), since an end equal to the start can
 * never be saved.
 *
 * @returns the end date the form should hold, 'YYYY-MM-DD'.
 */
export function rollEndDate(startDateStr: string, startTimeStr: string, endDateStr: string, endTimeStr: string): string {
  if (!endDateStr || endDateStr !== startDateStr) return endDateStr;
  const start = clockMinutes(startTimeStr);
  const end = clockMinutes(endTimeStr);
  if (start === null || end === null || end > start) return endDateStr;
  // Midnight + 24 h on the wall clock is the next calendar day; deriveEnd's
  // midday anchor keeps that DST-proof and validates the date for us.
  return deriveEnd(startDateStr, '00:00', 24).endDateStr || endDateStr;
}
