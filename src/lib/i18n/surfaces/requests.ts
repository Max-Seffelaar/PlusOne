/**
 * Requests surface copy (S5) — the approval inbox: landing-page guest requests
 * and quota requests, venue-wide or scoped to one event.
 *
 * Source deck: copy-deck.md §6 (Requests). Voice: app-general, low wink
 * (tone-of-voice.md). Sentence case, numerals, no em-dash habit, glossary terms
 * exact. Action pairs differ by queue: a guest-list request = Approve / Decline,
 * a quota request = Approve / Deny. Strings with {placeholders} are filled via fmt().
 *
 * Wire into `en` in ../en.ts as `requests`, then read via `t.requests.<key>`.
 */
export const requests = {
  // ── Header / scope ──────────────────────────────────────────────────────────
  title: 'Requests',
  scopeAll: 'All events',
  scopeEventFallback: 'Event',
  noVenue: 'No active venue selected.',

  // ── Search ──────────────────────────────────────────────────────────────────
  searchPlaceholder: 'Search by name…',
  searchAria: 'Search by name',
  clearSearchAria: 'Clear search',

  // ── Tabs ────────────────────────────────────────────────────────────────────
  tabLanding: 'Guest list',
  tabQuota: 'Quota',

  // ── List states ─────────────────────────────────────────────────────────────
  loading: 'Loading requests…',
  loadError: "Couldn't load the requests. Try again in a moment.",
  approveFailed: "Couldn't approve.",
  declineFailed: "Couldn't decline.",
  approveQuotaFailed: "Couldn't approve. This may need MFA.",

  // ── Landing-page (guest-list) queue ─────────────────────────────────────────
  landingNote:
    'Guest-list requests fall outside your own quota (#31). Approving one costs you no spot, but it still counts toward the tier max.',
  emptyLandingSearch: 'No open requests for "{q}".',
  emptyLanding: 'No requests right now. The line\'s clear.',
  cardPhoneVia: 'phone •••• {last4} · via landing page · {at}',
  cardVia: 'via landing page · {at}',
  decline: 'Decline',
  approveAdd: 'Approve…',

  // ── Denied (refused) section ────────────────────────────────────────────────
  deniedHeading: 'Declined · {n}',
  deniedPhone: 'phone •••• {last4} · {at}',
  declined: 'Declined',
  declinedReason: 'Declined — "{reason}"',
  approveAnyway: 'Approve anyway',

  // ── Quota queue ─────────────────────────────────────────────────────────────
  emptyQuotaSearch: 'No requests for "{q}".',
  emptyQuota: 'No open quota requests.',
  slotOne: 'slot',
  slotMany: 'slots',
  deny: 'Deny',
  approveExtra: 'Approve +{n}',

  // ── Event picker sheet ──────────────────────────────────────────────────────
  pickEventTitle: 'Pick an event',
  close: 'Close',

  // ── Assign (approve guest-list request) sheet ───────────────────────────────
  assignHeads: '{event} · {n} people',
  assignHeadsNoEvent: '{n} people',
  assignTierQuestion: 'Which tier does this guest go on?',
  assignLoadingTiers: 'Loading tiers…',
  assignNoTiers: 'This event has no tiers yet. Add one so we can put the guest on the right tier.',
  assignCreateTier: 'Add a tier',
  tierUsedOfMax: '{used}/{max} used',
  tierNoMax: 'No max',
  assignSummary: '{n} people land on the list',
  assignSummaryTierConnector: ' under ',
  assignBusy: 'Working…',
  assignConfirm: 'Add to the list',
  cancel: 'Cancel',

  // ── Deny / decline sheet ────────────────────────────────────────────────────
  declineHeading: 'Decline',
  denyHeading: 'Deny',
  declineFromLanding: 'Request from {name}',
  denyFromQuota: 'Quota request from {name}',
  reasonLabel: 'Reason',
  reasonRequired: '· required, the requester sees this',
  reasonPlaceholder: 'e.g. list\'s full, no room left for this event',
  declineBusy: 'Working…',
  declineConfirm: 'Confirm decline',
  denyConfirm: 'Confirm deny',
} as const;
