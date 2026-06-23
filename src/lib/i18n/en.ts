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
    door: 'Door',
    checkin: 'Check-in',
    tasks: 'Tasks',
    analytics: 'Analytics',
    team: 'Team',
    more: 'More',
  },
  door: {
    checkinTitle: 'Check-in',
    tasksTitle: 'Tasks',
    noEvent: 'No event to check in to yet. Create or open one first.',
  },
  venue: {
    switched: 'Switched to {name}',
    switching: 'Switching…',
  },
  sections: {
    account: 'Account',
    thisVenue: 'This venue',
    teamAccess: 'Team & access',
    insights: 'Insights',
    switchVenue: 'Switch venue',
  },
  guestsTab: {
    empty: 'No events yet. Create an event to start a guest list.',
  },
} as const;

export type Messages = typeof en;
