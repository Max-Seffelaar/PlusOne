/**
 * Analytics surface copy (was Statistieken; #26, spec §6) — venue-level KPIs plus
 * the per-event arrivals / tier / "added by" detail. Read-only, admin/finance only.
 *
 * Source deck: copy-deck.md §7 (Analytics). Voice: app-general, low wink
 * (tone-of-voice.md). Sentence case, numerals, no em-dash habit, glossary terms
 * exact (Turnout, Check-ins, Refusals, Inside, Tier, people). The screen title is
 * "Analytics". {placeholders} are filled via fmt().
 *
 * Wire into `en` in ../en.ts as `analytics`, then read via `t.analytics.<key>`.
 */
export const analytics = {
  // ── Header / access ─────────────────────────────────────────────────────────
  title: 'Analytics',
  noRights: "You don't have rights to view analytics.",
  fetchError: "Couldn't load statistics. Check your connection and try again.",
  retry: 'Try again',

  // ── Venue-level trends (parked, M6 86ey7dzmp — 8/7 UX/IA decision) ───────────
  // No venue-wide KPIs shown for now; they come back once retention/event
  // comparisons actually say something. Analytics is event-first instead.
  venueTrendsLater: 'Venue-wide trends (retention, comparisons across events) are coming later.',

  // ── Per-event picker ────────────────────────────────────────────────────────
  perEvent: 'Per event',
  noEventsYet: 'No events yet',
  pickEvent: 'Pick an event',
  pickEventTitle: 'Pick an event',

  // ── Per-event detail ────────────────────────────────────────────────────────
  loading: 'Loading…',
  peakWithCount: 'Peak · {n} in 15 min',
  peakLabel: 'Peak arrivals',
  noShowLabel: 'No-shows · {pct}%',
  arrivalsLabel: 'Arrivals by 15 min',
  noCheckins: 'No check-ins yet.',
  tierLabel: 'Inside vs. on the list, by tier',
  noTierData: 'No tier data.',
  addedByLabel: 'Added by',
  // The unit is locked to heads (guest + plus-ones), labelled so rows vs. heads
  // is never ambiguous (T9).
  addedByUnit: 'In heads (guest + plus-ones)',
  noOneAdded: 'No one has added guests yet.',
  // Per member: "12 checked in" · "· 3 removed" (only when > 0) · free/paid split
  // (only shown when the event uses a paid tier — paid tiers are display-only).
  memberCheckedIn: '{in} checked in',
  memberRemoved: '{n} removed',
  memberFreePaid: '{free} free · {paid} paid',
  addedWord: 'added',

  // ── Footer note ─────────────────────────────────────────────────────────────
  footerNote:
    'Every number hangs on the event, not the calendar day. Inside = checked in at the door.',
} as const;
