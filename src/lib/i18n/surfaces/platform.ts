/**
 * Platform (system) admin surface copy — the open-beta invite tab (P-04).
 *
 * Audience: PlusOne's own operators, not a venue. Dial = near-zero wink; this
 * is an internal console, so it says exactly what a button does and nothing
 * more. Sentence case, numerals for numbers, glossary terms verbatim.
 *
 * Composed into the central dictionary (`../index.ts`) — read as `t.platform.*`
 * and fill {placeholders} with `fmt`.
 */
export const platform = {
  navLabel: 'Platform',
  moreSub: 'Invite customers into the open beta',
  title: 'Platform',
  subtitle: 'Open beta invites',

  /** Shown to anyone who is not a platform admin (guessed/bookmarked URL).
   *  Deliberately flat: it does not confirm that such a surface exists for
   *  someone else, and RLS returns nothing regardless. */
  notAvailable: 'This section is not available for your account.',

  // ── Invite form ───────────────────────────────────────────────────────────
  inviteTitle: 'Invite a customer',
  inviteIntro:
    'Send one email. They create their own company and accept the terms themselves, so you do not set anything up for them.',
  emailPlaceholder: 'name@venue.com',
  emailLabel: 'Email address',
  noteLabel: 'Note (optional)',
  notePlaceholder: 'Where you met, who introduced you…',
  noteHint: 'Only visible here. Never shown to the person you invite.',
  send: 'Send invite',
  sending: 'Sending…',
  emailRequired: 'Fill in an email address first.',

  // ── List ──────────────────────────────────────────────────────────────────
  listTitle: 'Invited',
  empty: 'No invites yet. Send the first one above.',
  loadError: "Couldn't load the invites. Try again in a moment.",
  loading: 'Loading…',
  invitedOn: 'Invited {date}',
  invitedBy: 'by {name}',
  lastSent: 'Last email {date}',
  revokedOn: 'Stopped {date}',
  venues: '{count} company',
  venuesPlural: '{count} companies',
  events: '{count} event',
  eventsPlural: '{count} events',

  // Funnel stages, in order. `revoked` sits outside the progression.
  stageInvited: 'Invited',
  stageSignedIn: 'Signed in',
  stageCompanyCreated: 'Company created',
  stageFirstEvent: 'First event',
  stageRevoked: 'Stopped',

  funnelTitle: 'Funnel',
  funnelHint: 'Counted across every invite, not just the ones shown.',

  // ── Row actions ───────────────────────────────────────────────────────────
  resend: 'Resend',
  resending: 'Resending…',
  /** REVOKE COPY (orchestrator decision, Max decides the final behaviour).
   *  Revoking marks the row only: the invitee keeps a valid link and can still
   *  sign in and create a company. The label and helper must say so — one copy
   *  line, easy to change if the behaviour changes (PR #325, follow-up F1). */
  revoke: 'Stop following up',
  revoking: 'Stopping…',
  revokeHelp: 'Stops resends and hides them from the funnel. It does not block sign-in.',
  revokeConfirmTitle: 'Stop following up on {email}?',
  revokeConfirmBody:
    'They keep the link they already received and can still sign in and create a company. This only stops resends and marks the invite as closed.',
  revokeConfirm: 'Yes, stop following up',
  cancel: 'Cancel',
  actionsFor: 'Actions for {email}',

  // ── Venue overview + audit viewer (P-05) — nav from the Platform tab ───────
  venuesNavTitle: 'Venues',
  venuesNavSub: 'Every company, at a glance',
  auditNavTitle: 'Audit',
  auditNavSub: 'Who did what, everywhere',

  // ── Venues screen ─────────────────────────────────────────────────────────
  venuesTitle: 'Venues',
  venuesSubtitle: 'Every company on the platform',
  venuesSearchPlaceholder: 'Search by name…',
  venuesEmpty: 'No venues match that search.',
  venuesLoading: 'Loading venues…',
  venuesLoadError: "Couldn't load the venues. Try again in a moment.",
  venuesMembers: '{count} member',
  venuesMembersPlural: '{count} members',
  venuesEvents: '{count} event',
  venuesEventsPlural: '{count} events',
  venuesNoActivity: 'No activity yet',
  venuesLastActivity: 'Last activity {date}',
  venuesNoSubscription: 'No subscription',
  venuesOpenAudit: 'View audit',
  venuesSwitchInto: 'Switch into this venue',
  venuesCountOf: '{shown} of {total}',
  pagePrev: 'Previous',
  pageNext: 'Next',

  // Subscription status labels (subscription_status enum → display text).
  // Never render the raw enum value — `trialing`/`past_due` etc. are DB
  // vocabulary, not copy (review finding, z8uq9m0tnx).
  subscriptionTrialing: 'Trialing',
  subscriptionActive: 'Active',
  subscriptionPastDue: 'Past due',
  subscriptionCanceled: 'Canceled',
  subscriptionComped: 'Comped',

  // ── Audit screen ──────────────────────────────────────────────────────────
  auditTitle: 'Audit',
  auditSubtitle: 'Every audited action, across every venue',
  auditEmpty: 'No audit entries match these filters.',
  auditLoading: 'Loading audit entries…',
  auditLoadError: "Couldn't load the audit feed. Try again in a moment.",
  auditFilterVenueLabel: 'Venue',
  auditFilterAllVenues: 'All venues',
  auditFilterSinceLabel: 'From',
  auditFilterUntilLabel: 'Until',
  auditFilterClear: 'Clear filters',
  auditSupportBadge: 'Support action',
  // The flag is indicative, not forensic (review finding, z8uq9m0tnx): a
  // platform admin can self-insert a real membership at any venue (their
  // own is_platform_admin() already satisfies that policy's role check) and
  // un-flag their own past rows there — an audited trail, not a tamper-proof
  // one, so this hint stays a present-tense description of the check.
  auditSupportHint: 'The acting operator is not CURRENTLY a member of this venue.',
  auditNoVenue: 'No venue',
  auditUnknownActor: 'Unknown',
  auditColWho: 'Who',
  auditColAction: 'Action',
  auditColVenue: 'Venue',
  auditColWhen: 'When',
  auditDiffLabel: 'Before / after',
  auditNoDiff: 'No field-level diff for this action.',
  auditCountOf: '{shown} of {total}',
} as const;
