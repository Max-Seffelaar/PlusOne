/**
 * Home surface copy (S11 · Dashboard-home). Voice: app-general, low-mid wink.
 * Sources: copy-deck.md §3, tone-of-voice.md. Sentence case, numerals, no
 * em-dash habit, glossary terms exact (Inside · On the way · Turnout · Quota ·
 * Request · people). Strings with {placeholders} are filled via fmt() at the
 * call site.
 */
export const home = {
  // Greetings — hour-based, {name} embedded (copy-deck §3). `*NoName` variants
  // drop the trailing comma/punctuation when the user has no first name.
  greetMorning: 'Good morning, {name}.',
  greetMorningNoName: 'Good morning.',
  greetAfternoon: 'Good afternoon, {name}.',
  greetAfternoonNoName: 'Good afternoon.',
  greetEvening: 'Good evening, {name}.',
  greetEveningNoName: 'Good evening.',
  greetLate: 'Working late, {name}?',
  greetLateNoName: 'Working late?',

  title: 'Overview',
  refresh: 'Refresh',
  switchVenue: 'Switch venue',

  // Event card
  listLocked: 'List locked',
  switchEvent: 'Switch event',
  nextEventTomorrow: 'Next event tomorrow',
  nextEventInDays: 'Next event in {n} days',
  quietMeta: '{n} on the list · list {state}',
  quietStateLocked: 'locked',
  quietStateOpen: 'open',
  insideRegistered: 'inside · on the list',
  onTheWay: '{n} on the way',
  turnout: '{pct}% turnout',
  turnoutClosedSuffix: ', doors not open yet',
  openDoor: 'Open the door',

  // KPI tiles
  kpiInside: 'Inside',
  kpiInsideSubDoorsClosed: 'doors closed',
  kpiRequests: 'Requests',
  kpiRequestsSub: 'open',
  kpiQuota: 'Quota left',
  quotaSubUnknownValue: '—',
  quotaSubUnknown: 'unknown',
  quotaSubExemptValue: '∞',
  quotaSubExempt: 'no limit',
  quotaSubOf: 'of {total}',

  // Quick actions
  quickActions: 'Quick actions',
  actionAddGuest: 'Add guest',
  actionOpenDoor: 'Open the door',
  actionRequests: 'Review requests',

  // Activity feed (admin / AAL2)
  latest: 'Latest',
  auditLog: 'Audit log',
  loading: 'Loading…',
  nothingLogged: 'Nothing logged yet.',

  // Event picker sheet
  pickEvent: 'Pick an event',
  live: 'Live',

  // Quota sheet
  quotaSheetTitle: 'Your quota for this event',
  quotaNoLimit: 'No limit',
  quotaExemptBody:
    "As an admin or organizer, your guests don't count against a personal quota.",
  quotaSpotLeft: '{n} spot left',
  quotaSpotsLeft: '{n} spots left',
  quotaUsed: '{consumed} of {total} used',
  quotaSheetBody: 'This is your personal quota for this event. The database enforces the hard limit.',
  quotaAddGuest: 'Add guest',
  close: 'Close',

  // Empty / loading / error
  noEventTitle: 'Nothing on tonight',
  noEventBody: "Once an event is live or coming up, you'll see turnout, open requests, and your spots left here.",
  newEvent: 'New event',
  loadingOverview: 'Loading the overview…',
  loadError: "Couldn't load the overview. Try again in a moment.",
} as const;
