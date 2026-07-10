/**
 * Shared UI surface copy — the design-system kit, app shell chrome, and small
 * shared components (MFA step-up sheet, pending-invites banner, country picker).
 *
 * Dial = mostly near-zero wink (buttons, aria labels, the MFA gate, the invite
 * banner). Sentence case, numerals for numbers, no em-dash habit, glossary terms
 * verbatim (Team, Refuse, Quota, Tier, …).
 *
 * Composed into the central dictionary (`../en.ts`) — components read these as
 * `t.shared.<key>` and fill {placeholders} with `fmt`.
 */
export const shared = {
  // ── Design-system kit (kit.tsx) ──────────────────────────────────────────
  kit: {
    statusInside: 'Inside',
    statusOnTheWay: 'On the way',
    payMustPay: '€ must pay',
    stepperLess: 'Less',
    stepperMore: 'More',
    stepperUnit: 'people',
    back: 'Back',
    loadingAria: 'Loading',
    loading: 'Loading…',
  },

  // ── Date/time fields (datetime-field.tsx) — desktop calendar + time selects ──
  datetime: {
    datePlaceholder: 'Pick a date',
    dateAria: 'Pick a date',
    clear: 'Clear',
    today: 'Today',
    hourAria: 'Hour',
    minuteAria: 'Minutes',
    emptyTime: '--',
  },

  // ── App shell chrome (shell.tsx) ─────────────────────────────────────────
  shell: {
    tabStart: 'Home',
    tabEvents: 'Events',
    tabCheckin: 'Check-in',
    tabTasks: 'Tasks',
    tabMore: 'More',
    stageSub: 'guest list · clickable prototype',
    stageHint: 'Click through the flow. Type a name at Check-in.',
  },

  // ── In-app MFA step-up sheet (mfa-gate.tsx) ───────────────────────────────
  mfaGate: {
    title: 'Two-factor',
    subtitle: 'This action needs two-factor.',
    loading: 'Loading…',
    loadError: "Couldn't load your MFA status.",
    startError: "Couldn't start MFA. Try again.",
    genericError: 'Something went wrong.',
    close: 'Close',
    enrollNote: 'Scan the QR code with your authenticator app (or enter the key by hand), then enter the 6-digit code.',
    qrAlt: 'MFA QR code',
    codeLabel: '6-digit code',
    codeError: 'That code is wrong or expired. Try again.',
    verifying: 'Verifying…',
    verify: 'Verify',
    cancel: 'Cancel',
  },

  // ── Pending-invites banner (pending-invites-banner.tsx) ───────────────────
  invites: {
    headingOne: 'You have an open invite',
    headingMany: 'You have {n} open invites',
    accepting: 'Accepting…',
    acceptOne: 'Accept invite',
    acceptMany: 'Accept invites',
    error: "Couldn't accept the invite. Try again.",
  },

  // ── Country picker (country-select.tsx) ───────────────────────────────────
  country: {
    pickAria: 'Pick a country',
    searchPlaceholder: 'Search a country or code…',
    searchAria: 'Search a country',
    empty: 'No country found',
  },

  // ── Check-in status filter chips — shared by door.ts + cockpit.ts (the door
  //    PWA and the desktop Event-day cockpit filter the same three states) ───
  checkinFilters: {
    all: 'All',
    onTheWay: 'On the way',
    inside: 'Inside',
  },
} as const;
