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

  // ── S14 · mission-control board (multi-event dashboard) ──
  metaUpcoming: '{n} upcoming',
  metaDoorsOpen: 'doors open',
  newGuest: 'New guest',
  // pulse strip
  pulseRequests: 'Open requests',
  pulseQuota: 'Quota requests',
  // Staff/doorhost own-status tile (M1/M3, K-4/K-8): their venue-wide inbox is
  // hidden, so the label reflects "your own", not everyone's.
  pulseQuotaOwn: 'Your quota requests',
  pulseLive: 'Events live',
  deltaToday: 'today',
  // graph (one combined chart — requested vs on-the-list, per event)
  graphComboTitle: 'Requested vs on the list',
  graphComboSub: 'Open requests and approved guests, per event',
  legRequested: 'Requested',
  legOnList: 'On the list',
  graphHint: 'Hover an event for exact numbers',
  // events section
  eventsHeading: 'Events',
  upcomingEventsHeading: 'Upcoming events',
  pastEventsHeading: 'Past events',
  countFound: 'found',
  countTotal: 'total',
  searchEvents: 'Search events…',
  filterAll: 'All',
  filterToday: 'Today',
  filterUpcoming: 'Upcoming',
  pastEventsCount: '{n} past event',
  pastEventsCountPlural: '{n} past events',
  viewAllPast: 'More past events',
  pickEventForGuest: 'Add guest to…',
  noUpcomingToday: 'No events today or upcoming.',
  // status chips
  chipLive: 'Live',
  chipTonight: 'Tonight',
  chipUpcoming: 'Upcoming',
  chipPast: 'Past',
  // card counts
  cOnList: 'On the list',
  cRequests: 'Requests',
  cQuota: 'Quota',
  cInside: 'Inside',
  doorAt: 'doors {time}',
  // card actions (titles / aria)
  aOpen: 'Open',
  aDoor: 'Door',
  aRequests: 'Requests',
  aEdit: 'Edit',
  aLock: 'Lock list',
  aUnlock: 'Unlock list',
  // pagination
  pageOf: '{shown} of {total}',
  eventsCount: '{n} events',
  showMore: 'Show more ({n})',
  allShown: 'All {n} events shown',
  // empty states
  emptyFilteredTitle: 'No events found',
  emptyFilteredBody: 'Adjust your search or filter to see events.',
  clearFilters: 'Clear filters',
  emptyNoneTitle: 'Nothing scheduled',
  emptyNoneBody: 'No events on the calendar for this venue yet.',
  createEvent: 'Create an event',
  // toasts
  toastListOpen: '{name} · list open',
  toastListLocked: '{name} · list locked',
} as const;
