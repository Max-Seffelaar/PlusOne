/**
 * Single source of truth for date/time display across the po surface + door.
 * Everything renders in the product's timezone (Europe/Amsterdam) regardless of
 * the viewing device (#26) — C28 was the door being the one surface that didn't;
 * this module is what keeps every OTHER surface from drifting the same way.
 */

import type { GuestSource } from '@/lib/po/types';
import { t, fmt } from '@/lib/i18n';
import { absentStage, type EventPhase } from './event-phase';

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

// ── Guest provenance (ADE round, item J) ─────────────────────────────────────
// "Where did this name come from?" — the one display helper for `guests.source`,
// shared by the guest rows (list + table) and the person profile's Events card.

/** Just the projection `guestSourceLabel` reads — any Guest/appearance fits. */
export interface GuestSourceInput {
  source: GuestSource;
  /** Display name of who added them; null when the actor row isn't readable. */
  addedByName?: string | null;
  /** Non-default request link label (or its influencer); null for the default
   *  link and whenever `request_links` isn't readable for this role (RLS). */
  linkLabel?: string | null;
}

/** First name only — a row is tight and "Added by Max" beats "Added by Max Seffelaar". */
function firstName(full: string): string {
  return full.trim().split(/\s+/)[0] ?? '';
}

/**
 * One line naming where a guest came from. `landing` names the sign-up link (and
 * the specific link/influencer when it isn't the event's default one); `app` and
 * `door` name the person, falling back to "a colleague" when RLS hides the actor
 * profile — never a policy change to read a name (CLAUDE.md: RLS is the boundary).
 */
export function guestSourceLabel(g: GuestSourceInput): string {
  const s = t.guests.source;
  const who = g.addedByName ? firstName(g.addedByName) : '';
  switch (g.source) {
    case 'permanent':
      return s.regular;
    case 'landing':
      return g.linkLabel ? fmt(s.signUpLinkNamed, { label: g.linkLabel }) : s.signUpLink;
    case 'door':
      return who ? fmt(s.atDoorBy, { name: who }) : s.atDoorByColleague;
    default:
      return who ? fmt(s.addedBy, { name: who }) : s.addedByColleague;
  }
}

/**
 * Which request link a guest-list request came through, for the Requests inbox
 * (z8uq9m0hw4): the event's default link reads "Standard link", a custom one
 * "via {influencer or label}". Null only when the link can't be named at all
 * (no link on the row, or one this viewer can't read), never a guess.
 */
/** Copy for the recap's not-checked-in tile + list, by phase (z8uq9m0hw4). */
export interface RecapAbsentCopy {
  tile: string;
  /** `{n}` template, fill with fmt. */
  heading: string;
  tag: string;
  /** `{n}` template, fill with fmt. */
  showAll: string;
  empty: string;
}

/**
 * The recap names guests on the list who aren't inside by the same phase rule
 * as the stats panel (`absentStage`, Max's rule): null before the event (show
 * nothing), "On the way" while it runs, "No-shows" only after it has ended. The
 * recap is only linked for past events, but a direct URL to a live event's
 * recap must never say "no-show" mid-event.
 */
export function recapAbsentCopy(phase: EventPhase): RecapAbsentCopy | null {
  const stage = absentStage(phase);
  if (stage === 'hidden') return null;
  const e = t.events;
  return stage === 'onTheWay'
    ? { tile: e.onTheWay, heading: e.onTheWayLabel, tag: e.onTheWayTag, showAll: e.showAllOnTheWay, empty: e.everyoneInside }
    : { tile: e.noShows, heading: e.noShowsLabel, tag: e.noShowTag, showAll: e.showAllNoShows, empty: e.everyoneShowed };
}

export function requestLinkLabel(r: { viaStandard: boolean; viaLabel: string | null }): string | null {
  if (r.viaStandard) return t.requests.standardLink;
  return r.viaLabel ? fmt(t.requests.viaChip, { label: r.viaLabel }) : null;
}
