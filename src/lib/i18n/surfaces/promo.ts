/**
 * Promotion dashboard copy (Requests-epic F2, 86ey6b3fe — S15). The internal
 * analytics screen that answers "who actually pulls people through the door":
 * overview funnel per event, the venue-wide influencer leaderboard, label-only
 * links, the per-event funnel and the create-request-link flow. Strings are the
 * approved Claude Design copy, verbatim. {placeholders} are filled via fmt().
 */
export const promo = {
  title: 'Promotion',
  /** More-hub row + Statistieken link-row sub. */
  hubSub: 'Who pulls people through the door',

  // ── Overview card ───────────────────────────────────────────────────────────
  overviewKicker: 'Overview',
  overviewTitle: 'How your links are pulling',
  stepViews: 'Views',
  stepRequests: 'Requests',
  stepApproved: 'Approved',
  stepCheckedIn: 'Checked in',
  convRequested: 'requested',
  convApproved: 'approved',
  convShowedUp: 'showed up',
  convLinks: '{n} links on this event',

  // ── Section 1 — leaderboard ─────────────────────────────────────────────────
  deliversKicker: 'Section 1',
  deliversTitle: 'Who actually delivers',
  deliversSub: 'Ranked by checked-in headcount, across every event',
  range30: '30 days',
  range90: '90 days',
  rangeAll: 'All time',
  rowSub: '{links} links · {events} events',
  checkedInLabel: 'checked in',
  funnelViews: 'views',
  funnelRequests: 'requests',
  funnelApproved: 'approved',
  funnelIn: 'in',
  showing: 'Showing',
  showingOf: 'of {n} {unit}',
  unitInfluencers: 'influencers',
  unitLinks: 'links',
  pagePrevAria: 'Previous page',
  pageNextAria: 'Next page',

  // ── Section 1 · unattributed — label-only links ─────────────────────────────
  noInfKicker: 'Section 1 · unattributed',
  noInfTitle: 'No influencer',
  noInfSub: 'Label-only links you shared yourself',
  labelOnlySub: 'Label-only link',

  // ── Section 2 — per-event funnel ────────────────────────────────────────────
  perEventKicker: 'Section 2',
  perEventTitle: 'Per-event funnel',
  perEventSub: 'Every request link on {event}',
  newLink: 'New link',
  requestLinkSub: 'Request link',
  standardName: 'Standard link',
  chipAuto: 'Auto',
  chipFull: '{heads}/{max} full',
  eventPickerAria: 'Pick an event',

  // ── Empty / loading / error states ──────────────────────────────────────────
  emptyTitle: 'No links yet',
  emptyBody:
    "Create a request link on your event and share it — the moment people start requesting, this is where you'll see who's pulling.",
  emptyCta: 'Create request link',
  loadingTitle: 'Counting who came through the door',
  loadingSub: 'Crunching views, requests and check-ins',
  loadError: "Couldn't load the promotion numbers. Try again in a moment.",
  noRights: 'Promotion stats need admin, finance or organizer rights.',
  noEvents: 'No events yet. Create an event first — links live on an event.',

  // ── Create request link modal ───────────────────────────────────────────────
  createTitle: 'Create request link',
  createSub: 'Share it — every request routes back to you.',
  closeAria: 'Close',
  eventLabel: 'Event',
  attachToLabel: 'Attach to',
  attachInfluencer: 'Influencer',
  attachLabel: 'Label only',
  influencerNamePlaceholder: 'Influencer name',
  labelPlaceholder: 'Link label — e.g. Instagram bio',
  tierLabel: 'Ticket / tier',
  tierExplainer: 'Guests on this link get the {tier} ticket for {event}.',
  noTiersHint: 'This event has no tiers yet — the link works, guests just get no fixed ticket.',
  autoApproveTitle: 'Auto-approve requests',
  autoApproveSub: 'Everyone who requests gets in — no manual review.',
  autoApproveNeedsTier: 'Auto-approve needs a tier on the event.',
  capacityTitle: 'Set a capacity',
  capacitySub: "Close the link once it's full.",
  capacityUnit: 'spots',
  capacityLessAria: 'Fewer spots',
  capacityMoreAria: 'More spots',
  createCta: 'Create link',
  creating: 'Creating…',
  errCreate: "Couldn't create the link.",

  // Done step.
  doneTitle: 'Your link is live',
  doneBodyTier: '{name} can start pulling for {event} — every guest gets the {tier} ticket.',
  doneBody: '{name} can start pulling for {event}.',
  doneAuto: ' Requests auto-approve.',
  doneCap: ' Capped at {cap}.',
  doneFallbackInfluencer: 'This influencer',
  doneFallbackLabel: 'This label',
  copy: 'Copy',
  copied: 'Copied',
  createAnother: 'Create another',
  done: 'Done',
} as const;
