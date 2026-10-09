/**
 * Platform (system) admin surface copy — the open-beta invite tab (P-04).
 *
 * Audience: PlusOne's own operators, not a company. Dial = near-zero wink; this
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
  emailPlaceholder: 'name@company.com',
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
  anonymizedTitle: 'Anonymized invite',
  anonymizedHelp: 'Email address and note were removed after 24 months without contact.',
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

  // ── Company overview + audit viewer (P-05) — nav from the Platform tab ───────
  venuesNavTitle: 'Companies',
  venuesNavSub: 'Every company, at a glance',
  auditNavTitle: 'Audit',
  auditNavSub: 'Who did what, everywhere',
  accessLogNavTitle: 'Access log',
  accessLogNavSub: 'When we switched into a customer company',

  // ── Companies screen ─────────────────────────────────────────────────────────
  venuesTitle: 'Companies',
  venuesSubtitle: 'Every company on the platform',
  venuesSearchPlaceholder: 'Search by name…',
  venuesEmpty: 'No companies match that search.',
  venuesLoading: 'Loading companies…',
  venuesLoadError: "Couldn't load the companies. Try again in a moment.",
  venuesMembers: '{count} member',
  venuesMembersPlural: '{count} members',
  venuesEvents: '{count} event',
  venuesEventsPlural: '{count} events',
  venuesNoActivity: 'No activity yet',
  venuesLastActivity: 'Last activity {date}',
  venuesNoSubscription: 'No subscription',
  venuesOpenAudit: 'View audit',
  venuesSwitchInto: 'Switch into this company',
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
  subscriptionComped: 'Always free',
  // Trial management per company (Billing G): "Trial until <date>" and
  // "Always free", through set_venue_trial_end / set_venue_comped.
  billingTrialUntil: 'Trial until {date}',
  billingTrialEnded: 'Trial ended {date}',
  billingAlwaysFree: 'Always free',
  billingAlwaysFreeSub: 'Never billed. Switch off to start a new 14-day trial.',
  billingTrialDateLabel: 'Trial until',
  billingSetTrial: 'Set trial end',
  billingWorking: 'Saving…',
  billingStripeManaged: 'This company pays through Stripe. Change it in the Stripe dashboard.',
  billingTrialOutOfRange: 'Pick a date from today up to two years ahead.',
  billingLoadError: "Couldn't load the billing state.",
  // Billing-mails B1 (z8uq9m2z19): the timeline in each Companies card.
  billingMailsToggle: 'Billing mails',
  billingMailsToggleAria: 'Billing mails for {name}',
  billingMailsPause: 'Pause billing mails',
  billingMailsPauseSub: 'No trial or billing mail goes to this company while this is on.',
  billingMailsNone: 'No billing mail sent yet.',
  billingMailsNext: 'Next: {mail} · {date}',
  billingMailsNextNone: 'No trial mail left to send.',
  billingMailsLoadError: "Couldn't load the billing mails.",
  billingMailsHint: 'Mails go to the admins and finance of this company. Stripe sends the invoices.',
  billingMailRecipient: '1 recipient',
  billingMailRecipients: '{count} recipients',
  billingMailDelivered: '{count} delivered',
  billingMailSending: '{count} sent',
  billingMailFailed: '{count} failed',
  billingMailBounced: '{count} bounced',
  billingMailTrialDay0: 'Welcome, trial started',
  billingMailTrialDay7: 'Trial: 7 days left',
  billingMailTrialDay12: 'Trial: 2 days left',
  billingMailTrialEnded: 'Trial ended',
  billingMailTrialDay21: 'Last trial reminder',
  billingMailPaymentFailed: 'Charge failed',
  billingMailCanceled: 'Subscription ended',

  // ── Audit screen ──────────────────────────────────────────────────────────
  auditTitle: 'Audit',
  auditSubtitle: 'Every audited action, across every company',
  auditEmpty: 'No audit entries match these filters.',
  auditLoading: 'Loading audit entries…',
  auditLoadError: "Couldn't load the audit feed. Try again in a moment.",
  auditFilterVenueLabel: 'Company',
  auditFilterAllVenues: 'All companies',
  auditFilterSinceLabel: 'From',
  auditFilterUntilLabel: 'Until',
  auditFilterClear: 'Clear filters',
  auditSupportBadge: 'Support action',
  // The flag is indicative, not forensic (review finding, z8uq9m0tnx): a
  // platform admin can self-insert a real membership at any company (their
  // own is_platform_admin() already satisfies that policy's role check) and
  // un-flag their own past rows there — an audited trail, not a tamper-proof
  // one, so this hint stays a present-tense description of the check.
  auditSupportHint: 'The acting operator is not CURRENTLY a member of this company.',
  auditNoVenue: 'No company',
  auditUnknownActor: 'Unknown',
  auditColWho: 'Who',
  auditColAction: 'Action',
  auditColVenue: 'Company',
  auditColWhen: 'When',
  auditDiffLabel: 'Before / after',
  auditNoDiff: 'No field-level diff for this action.',
  auditCountOf: '{shown} of {total}',

  // ── Access log screen (legal v0.3 B3) ─────────────────────────────────────
  // Internal only — the company never sees this list; we share it on request
  // (DPA 4.4). The subtitle says what is and isn't in it, so nobody reads it
  // as a complete record of every read.
  accessLogTitle: 'Access log',
  accessLogSubtitle:
    'Every switch by a platform admin into a company they are not a member of. One row per switch, not per visit; direct database reads and other cross-company screens are not in here.',
  accessLogEmpty: 'No company access logged for this filter.',
  accessLogLoading: 'Loading the access log…',
  accessLogLoadError: "Couldn't load the access log. Try again in a moment.",
  accessLogFilterVenueLabel: 'Company',
  accessLogFilterAllVenues: 'All companies',
  accessLogFilterClear: 'Clear filter',
  accessLogUnknownAdmin: 'Unknown',
  accessLogUnknownVenue: 'Unknown company',
  accessLogNoReason: 'No reason given',
  accessLogColWho: 'Who',
  accessLogColVenue: 'Company',
  accessLogColReason: 'Reason',
  accessLogColWhen: 'When',
  accessLogCountOf: '{shown} of {total}',
  // ── Company detail: one block for Invites AND Companies (z8uq9m2ybj) ──────
  companyTrialDaysLeft: 'Trial · {count} days left',
  companyTrialDayLeft: 'Trial · 1 day left',
  companyTrialEndsToday: 'Trial · ends today',
  companyTrialEnded: 'Trial ended',
  companyTrialStripe: 'Trial · billing via Stripe',
  companyPaidMonthly: 'Paid monthly',
  companyPaidYearly: 'Paid yearly',
  companyPaid: 'Paid',
  companyEvent: '{count} event',
  companyEvents: '{count} events',
  companyLatestEvent: 'latest: {name}, {date}',
  companyNoEvents: 'No events yet',
  companyLastLogin: 'Last login {ago}',
  companyNoLogin: 'Owner never logged in',
  companyLastCheckIn: 'last check-in {date}',
  companyNoCheckIn: 'no check-ins yet',
  companyToday: 'today',
  companyYesterday: 'yesterday',
  companyDaysAgo: '{count} days ago',
  companySwitch: 'Switch',
  companySwitchAria: 'Switch into {name}',
  companyEventsAria: 'Open the events of {name}',
  companyLoadError: "Couldn't load this company's details.",

  // ── Overview screen (z8uq9m2ybj) ──────────────────────────────────────────
  overviewNavTitle: 'Overview',
  overviewNavSub: 'Companies, revenue, trials and usage',
  overviewTitle: 'Overview',
  overviewSubtitle: 'The platform in numbers',
  overviewLoadError: "Couldn't load these numbers. Try again in a moment.",
  overviewStatusTitle: 'Companies by status',
  overviewTotal: 'All companies',
  overviewTrialing: 'Trial',
  overviewTrialLapsed: 'Trial ended',
  overviewPaidMonthly: 'Paid monthly',
  overviewPaidYearly: 'Paid yearly',
  overviewPaidUnknown: 'Paid, interval unknown',
  overviewPastDue: 'Past due',
  overviewCanceled: 'Canceled',
  overviewComped: 'Always free',
  overviewNoSubscription: 'No subscription',
  overviewRevenueTitle: 'Revenue',
  overviewMrr: 'MRR',
  overviewArr: 'ARR',
  overviewRevenueHint: 'From our records, excluding discounts and dunning. Excl. VAT.',
  overviewRevenueNoPrices: 'No prices from Stripe yet, so no amount.',
  overviewRevenueLeftOutOne: 'Leaves out 1 paying company with no known interval.',
  overviewRevenueLeftOut: 'Leaves out {count} paying companies with no known interval.',
  overviewTrialsTitle: 'Trials',
  overviewEnding7d: 'Ending in 7 days',
  overviewConverted30d: 'Converted, last 30 days',
  overviewConverted90d: 'Converted, last 90 days',
  overviewCanceled30d: 'Canceled, last 30 days',
  overviewConvertedValue: '{converted} of {ended}',
  overviewTrialsHint: 'A trial counts once its end date has passed. Converted means it pays now.',
  overviewUsageTitle: 'Last 30 days',
  overviewActiveCompanies: 'Companies with an event',
  overviewEvents: 'Events',
  overviewCheckIns: 'Check-ins',
  overviewDormant: 'Dormant companies',
  overviewUsageHint: 'Dormant: no login and no event in the last 30 days.',
} as const;
