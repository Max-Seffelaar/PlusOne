/**
 * Public per-event landing page copy (`/e/[slug]`: §1 of copy-deck.md).
 *
 * Dial = HIGH wink (sell the vibe). The §1 strings were carefully humanized —
 * used verbatim. Wireframe-only extras (the form card header/sub, the headcount
 * stepper, the closes-banner, the privacy note) follow tone-of-voice.md:
 * sentence case, numerals, no em-dash habit, glossary terms exact (Guest, +N,
 * check in, Door, PlusOne).
 *
 * Composed into the central dictionary (`../en.ts`) — components read these as
 * `t.landing.<key>` and fill {placeholders} ({event}, {name}, {closes}, {n})
 * with `fmt`.
 */
export const landing = {
  // ── Hero ─────────────────────────────────────────────────────────────────
  eyebrow: '{event} · guest list',
  heroTitle: "You're almost on the list.",
  heroSub: "Drop your name and we'll see you at the door. No QR, no screenshots.",
  doorsAt: 'doors {time}',

  // ── Form card ────────────────────────────────────────────────────────────
  formTitle: 'Get yourself on the list',
  formSub: 'Drop your name. The rest helps us spot you faster at the door.',
  closesBanner: 'Sign-ups close {closes}',

  nameLabel: 'Name',
  namePlaceholder: 'First and last name',
  nameFallback: 'guest',

  plusOnesLabel: 'How many of you',
  plusOnesNote: 'including you',
  personSingular: 'person',
  personPlural: 'people',
  stepLessAria: 'Fewer',
  stepMoreAria: 'More',

  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  optional: 'optional',

  phoneLabel: 'Phone number',
  phoneAria: 'Phone number',
  phonePlaceholder: '6 12 34 56 78',

  messageLabel: 'Anything we should know?',
  messagePlaceholder: 'e.g. friend of the DJ, birthday…',

  marketingTitle: 'Keep me posted',
  marketingSub: 'Keep me posted on upcoming nights.',

  submit: 'Request my spot',
  submitting: 'Sending…',
  privacyNote: 'Your details go only to the organizer of this event and are anonymized automatically after the retention period. No account needed.',

  // ── Validation ───────────────────────────────────────────────────────────
  emailError: "That email doesn't look right. Mind checking it?",
  phoneError: 'Check your phone number, including the country code.',

  // ── Success ──────────────────────────────────────────────────────────────
  successTitle: "Request sent. You're in the queue.",
  // "Nice one, {name}." with the name in a styled span, then optional "(+{n})",
  // then the review line; split so the name + +N keep their own styling.
  successGreetPre: 'Nice one, ',
  successPlus: '(+{n})',
  successReview: '. {event} is reviewing your spot. We\'ll sort the rest at the door.',
  successInfo: 'No need to screenshot this. We check you in by name at the door.',
  successReset: 'Add someone else',

  // ── Closed / unknown slug ────────────────────────────────────────────────
  closedTitle: 'The list is closed.',
  closedBody: "This sign-up link isn't active anymore. Ask the organizer for a fresh one.",

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: 'Guest list, handled by PlusOne',
} as const;
