/**
 * Audit-log surface copy (S10, #15) — the immutable logbook chrome: titles, the
 * MFA gate, the immutability note, table headers, filter sheet, and the per-guest
 * timeline. The log SENTENCES themselves (e.g. "Mara added Juri (+2).") are built
 * in the shared features/audit/translate.ts and are NOT in this catalogus.
 *
 * Source deck: copy-deck.md §8 (Audit log). Voice: zero wink, trust-first
 * (tone-of-voice.md). Sentence case, numerals, no em-dash habit, glossary terms
 * exact (Audit log, Event, Team, Door host). {placeholders} are filled via fmt().
 *
 * Wire into `en` in ../en.ts as `audit`, then read via `t.audit.<key>`.
 */
export const audit = {
  // ── Header / access ─────────────────────────────────────────────────────────
  title: 'Audit log',
  noRights: "You don't have rights to view the audit log.",
  filterAria: 'Filter',

  // ── Immutability note ───────────────────────────────────────────────────────
  immutableNote:
    'Immutable logbook — written by database triggers, never by app code (#15). Access needs an admin or finance role plus MFA.',

  // ── MFA gate ────────────────────────────────────────────────────────────────
  loading: 'Loading…',
  mfaTitle: 'Verify it\'s you',
  mfaBody: 'Opening the immutable logbook needs a two-step verified session.',
  mfaVerify: 'Verify',

  // ── List states ─────────────────────────────────────────────────────────────
  loadError: "Couldn't load the audit log.",
  emptyFiltered: 'No results for these filters.',
  empty: 'Nothing logged yet.',

  // ── Desktop table ───────────────────────────────────────────────────────────
  colWho: 'Who',
  colEvent: 'Event',
  colAction: 'Action',
  colDevice: 'Device',
  colWhen: 'When',
  rowHistoryTitle: 'Timeline for {name}',

  // ── Filter sheet ────────────────────────────────────────────────────────────
  filterTitle: 'Filter',
  clear: 'Clear',
  searchPlaceholder: 'Search by name…',
  filterActionLabel: 'Action',
  filterEventLabel: 'Event',
  filterAllEvents: 'All events',
  filterUserLabel: 'Person',
  filterAllUsers: 'All people',
  showResults: 'Show results',

  // ── Per-guest timeline ──────────────────────────────────────────────────────
  historyTitle: 'Timeline',
  historyLoadError: "Couldn't load the timeline.",
  historyOf: 'Timeline for',
  guestNotVisible: 'This guest isn\'t visible anymore.',
  timelineLabel: 'Timeline',
  noGuestEvents: 'No events for this guest yet.',
} as const;
