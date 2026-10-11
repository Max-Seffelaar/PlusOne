/**
 * Audit-log surface copy (S10, #15) — the immutable logbook chrome: titles, the
 * immutability note, table headers, filter sheet, and the per-guest timeline.
 * The log SENTENCES themselves (e.g. "Mara added Juri (+2).") are composed in
 * the shared features/audit/translate.ts; the phrases for every table added
 * after the first audit phases, and the generic fallback, live in `line` below.
 *
 * Source deck: copy-deck.md §8 (Audit log). Voice: zero wink, trust-first
 * (tone-of-voice.md). Sentence case, numerals, no em-dash habit, glossary terms
 * exact (Audit log, Event, Team, Door host). {placeholders} are filled via fmt().
 *
 * Wire into `en` in ../en.ts as `audit`, then read via `t.audit.<key>`.
 */
export const audit = {
  // ── Header / access ─────────────────────────────────────────────────────────
  title: 'Audit log',
  noRights: "You don't have rights to view the audit log.",
  filterAria: 'Filter',

  // ── Immutability note ───────────────────────────────────────────────────────
  // MFA dropped from this copy: audit-log access is role-only (admin/finance),
  // not AAL2-gated — see migration 20260624160000_mfa_scope_sensitive_actions.
  immutableNote: 'Immutable logbook: written by database triggers, never by app code. Access needs an admin or finance role.',

  // ── List states ─────────────────────────────────────────────────────────────
  loading: 'Loading…',
  loadError: "Couldn't load the audit log.",
  emptyFiltered: 'No results for these filters.',
  empty: 'Nothing logged yet.',

  // ── Desktop table ───────────────────────────────────────────────────────────
  colWho: 'Who',
  colEvent: 'Event',
  colAction: 'Action',
  colDevice: 'Device',
  colWhen: 'When',
  rowHistoryTitle: 'Timeline for {name}',

  // ── Filter sheet ────────────────────────────────────────────────────────────
  filterTitle: 'Filter',
  clear: 'Clear',
  searchPlaceholder: 'Search by name…',
  filterActionLabel: 'Action',
  filterEventLabel: 'Event',
  filterAllEvents: 'All events',
  filterUserLabel: 'Person',
  filterAllUsers: 'All people',
  showResults: 'Show results',

  // ── Action chips (row marker) + action filter ───────────────────────────────
  // One short label per action the audit triggers and RPCs emit
  // (features/po/audit-presenter.ts). `fallback` only for an action added
  // later without a label here.
  actionLabel: {
    create: 'Added',
    update: 'Change',
    delete: 'Removed',
    checkIn: 'Check-in',
    refuse: 'Refused',
    tierChange: 'Tier',
    quotaGrant: 'Quota',
    approve: 'Approved',
    deny: 'Declined',
    lock: 'Locked',
    unlock: 'Unlocked',
    anonymize: 'Anonymized',
    export: 'Export',
    platformAdminGrant: 'Admin granted',
    platformAdminRevoke: 'Admin revoked',
    fallback: 'Action',
  },
  // Filter chips that group several actions.
  filterAll: 'All',
  filterListLock: 'List lock',
  filterPrivacy: 'Privacy',

  // ── Per-guest timeline ──────────────────────────────────────────────────────
  historyTitle: 'Timeline',
  historyLoadError: "Couldn't load the timeline.",
  historyOf: 'Timeline for',
  guestNotVisible: 'This guest isn\'t visible anymore.',
  timelineLabel: 'Timeline',
  noGuestEvents: 'No events for this guest yet.',

  // ── Log lines (features/audit/translate.ts) ─────────────────────────────────
  // The phrase AFTER the bold actor ("Robin Vermeer" + "started the free
  // trial"): past tense, lowercase start, no period. {name} etc. are data
  // (a contact, template, or influencer name), never the actor. No e-mail or
  // phone number ever goes into a line. The older guest/quota/request phrases
  // still live in translate.ts; every table added since lives here.
  line: {
    // Billing (subscriptions): webhook, onboarding, and the Platform tab.
    subscriptionTrialStarted: 'started the free trial',
    subscriptionTrialStartedUntil: 'started the free trial, until {date}',
    subscriptionStarted: 'started the subscription',
    subscriptionComped: 'marked the company as always free',
    subscriptionCompedOff: 'turned off always free, trial until {date}',
    subscriptionTrialEnd: 'set the trial to end on {date}',
    subscriptionAdeTrial: 'extended the trial to {date} with a free until end of ADE invite',
    subscriptionStatus: 'set the subscription to {status}',
    subscriptionInterval: 'switched billing to {interval}',
    subscriptionUpdated: 'updated the subscription',
    subscriptionEntity: 'the subscription',
    subscriptionStatusTrialing: 'trial',
    subscriptionStatusActive: 'active',
    subscriptionStatusPastDue: 'payment overdue',
    subscriptionStatusCanceled: 'canceled',
    subscriptionStatusComped: 'always free',
    intervalMonth: 'monthly',
    intervalYear: 'yearly',

    // Contacts (the company's guest book).
    contactCreated: 'added a contact: {name}',
    contactCreatedUnnamed: 'added a contact',
    contactUpdated: 'updated the contact {name}',
    contactUpdatedUnnamed: 'updated a contact',
    contactRemoved: 'removed the contact {name}',
    contactRemovedUnnamed: 'removed a contact',
    contactAnonymized: 'anonymized a contact',
    contactEntity: 'a contact',

    // Anonymization (data retention) of a guest or a request.
    guestAnonymized: 'anonymized {name}',
    requestAnonymized: 'anonymized the request from {name}',

    // Door: a check-out voids the check-in, a partial check-out re-opens it.
    checkOut: 'checked out {name}',
    checkInAgain: 'checked {name} back in',
    checkInAgainPlus: 'checked {name} back in +{count}',
    checkInChangedPlus: "changed {name}'s check-in to +{count}",
    checkInChanged: 'changed the check-in for {name}',
    checkInRemoved: 'removed the check-in for {name}',
    refusalChanged: 'changed the refusal for {name}',
    refusalRemoved: 'removed the refusal for {name}',

    // Event settings.
    eventDefaultQuota: 'set the default crew quota for {event} to {count}',

    // Team and crew invites. Never the invitee's e-mail address.
    inviteTeam: 'invited someone to the team ({roles})',
    inviteCrew: 'invited someone to the external crew',
    inviteAccepted: 'accepted the invite',
    inviteDeclined: 'declined the invite',
    inviteResent: 'resent an invite',
    inviteUpdated: 'updated an invite',
    inviteCanceled: 'canceled an invite',
    inviteEntity: 'an invite',

    // Influencers. {influencer} = influencerNamed or influencerUnnamed.
    influencerCreated: 'added {influencer}',
    influencerArchived: 'archived {influencer}',
    influencerRestored: 'restored {influencer}',
    influencerUpdated: 'updated {influencer}',
    influencerNamed: 'the influencer {name}',
    influencerUnnamed: 'an influencer',

    // Event templates and their tiers. {template} / {tier} = the named or
    // unnamed variant below.
    templateCreated: 'created {template}',
    templateUpdated: 'updated {template}',
    templateRemoved: 'removed {template}',
    templateNamed: 'the template {name}',
    templateUnnamed: 'a template',
    templateTierCreated: 'added {tier} to a template',
    templateTierUpdated: 'updated {tier} on a template',
    templateTierRemoved: 'removed {tier} from a template',
    templateTierNamed: 'tier {name}',
    templateTierUnnamed: 'a tier',

    // PlusOne's own operators (Platform tab).
    platformInviteSent: 'sent a platform invite',
    platformInviteSentAde: 'sent a platform invite, free until end of ADE',
    platformInviteResent: 'resent a platform invite',
    platformInviteRevoked: 'revoked a platform invite',
    platformInviteUsed: 'used a free until end of ADE invite',
    platformInviteAnonymized: 'anonymized a platform invite',
    platformInviteUpdated: 'updated a platform invite',
    platformInviteEntity: 'a platform invite',
    platformAdminGranted: 'granted platform admin rights',
    platformAdminRevoked: 'revoked platform admin rights',
    platformAdminEntity: 'platform admin rights',

    // Fallback for any table or action without its own line: never print a
    // raw table name or action verb.
    fallbackCreated: 'added a record',
    fallbackUpdated: 'updated a record',
    fallbackRemoved: 'removed a record',
    fallbackOther: 'made a change',
    fallbackEntity: 'a record',
  },
} as const;
