/**
 * English UI copy — the single source of truth (the "message catalogus").
 *
 * English is the default and, for now, the only locale. Adding a second language
 * is a sibling dictionary plus a switch in ./index.ts — not a refactor. Zero deps,
 * Capacitor-safe (#37).
 *
 * Voice + rules: tone-of-voice.md (repo root). Full string deck: copy-deck.md.
 * Grow this per screen as copy is wired; keep keys grouped by surface, sentence
 * case, numerals for numbers, no em-dash habit.
 */
export const en = {
  common: {
    loading: 'Loading…',
    account: 'Account',
  },
  nav: {
    home: 'Home',
    events: 'Events',
    guests: 'Guests',
    contacts: 'Contacts',
    /** The Deur tab / sidebar entry. Renamed to "Check-in" (ADE UX round, item L,
     *  17/9): "Door" read as a place, not as the thing you do there. The KEY stays
     *  `door` because it names the tab, not the label. The physical-door copy
     *  ("Doors 23:00", door price, the doorhost role) is unchanged. */
    door: 'Check-in',
    checkin: 'Check-in',
    tasks: 'Tasks',
    analytics: 'Analytics',
    promotion: 'Promotion',
    requests: 'Requests',
    team: 'Team',
    more: 'More',
  },
  door: {
    checkinTitle: 'Check-in',
    tasksTitle: 'Tasks',
    noEvent: 'No event to check in to yet. Create or open one first.',
  },
  venue: {
    switching: 'Switching…',
    /** The switch was refused server-side — almost always a membership revoked
     *  between the render of the venue list and the tap (86eykm7rk). Names the
     *  cause and the one action that helps, because a retry never will. */
    switchFailed: 'You no longer have access to that venue. Refresh to see your current venues.',
    /** The action threw (network blip, 500) rather than refusing. Distinct from
     *  `switchFailed`: nothing is wrong with the user's access, so the honest
     *  advice is "try again" — the opposite of what switchFailed says (86eykm7rk). */
    switchError: 'Could not switch venue. Check your connection and try again.',
  },
  sections: {
    account: 'Account',
    thisVenue: 'This venue',
    teamAccess: 'Team & access',
    insights: 'Insights',
  },
  guestsTab: {
    empty: 'No events yet. Create an event to start a guest list.',
  },
  /** Server-side outcomes of deciding a quota request (src/features/quotas/actions.ts).
   *  The approve RPC raises SQLSTATE 45003 with a Dutch message; the action maps
   *  it by code to this copy and never shows the raw DB text. */
  quotaRequests: {
    alreadyHandled: 'This request has already been handled.',
    notDecidable: 'This request has already been handled or cannot be decided by you.',
  },
} as const;

export type Messages = typeof en;
