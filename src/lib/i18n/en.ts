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
  /** Push notifications in the native app (Fase 17 N5). Never shown on the web. */
  push: {
    /** Android system settings → Notifications: the one channel we post to. */
    channelName: 'Requests',
    channelDescription: 'Guest list and quota requests, and decisions on yours.',
    askTitle: 'Know when a request comes in',
    askBody: 'Get a notification when someone asks for a spot or extra quota, and when your own request is decided. Nothing else.',
    askEnable: 'Turn on',
    askLater: 'Not now',
    /** After a denial from the ask card. */
    deniedToast: 'Notifications are off. You can turn them on later in Profile.',
    profileTitle: 'Push notifications',
    profileSubOn: 'On for this device: new requests and decisions on yours.',
    profileSubOff: 'Off for this device.',
    profileBlocked: "Blocked in your phone's settings. Open Settings → Apps → PlusOne → Notifications to allow them.",
    profileError: 'Could not change notifications. Check your connection and try again.',
    /** "Off" was saved on the device, but the server could not be reached to stop
     *  delivery yet. The app retries on its next start; this says so honestly. */
    profileOffPending: "Turned off on this device, but we couldn't reach the server yet. It finishes the next time the app is online.",
    /** Foreground receipt: an in-app toast instead of a system notification. */
    foreground: {
      quota_request_created: 'New quota request. Open Requests to review it.',
      guest_request_created: 'New guest request. Open Requests to review it.',
      quota_request_decided: 'Your quota request was decided. Open Requests to see it.',
    },
  },
} as const;

export type Messages = typeof en;
