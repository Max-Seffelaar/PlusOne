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
  // Subtle provenance on influencer/label links ("via Jayden").
  viaLine: 'via {name}',

  // ── Form card ────────────────────────────────────────────────────────────
  formTitle: 'Get yourself on the list',
  // 86eyke279: e-mail + phone are required now, so the sub no longer promises
  // that "the rest" is a bonus — it says what we need and why.
  formSub: 'Name, email and phone. The organizer needs a way to reach you once your spot is confirmed.',
  closesBanner: 'Sign-ups close {closes}',

  nameLabel: 'Name',
  namePlaceholder: 'First and last name',
  nameFallback: 'guest',

  plusOnesLabel: 'How many of you',
  plusOnesNote: 'including you',
  // Capped links (#43, Max 6-7-2026): disclose what can still be approved.
  spotsLeftNote: '{n} spots left',
  spotsLeftOne: '1 spot left',
  personSingular: 'person',
  personPlural: 'people',
  stepLessAria: 'Fewer',
  stepMoreAria: 'More',

  emailLabel: 'Email',
  emailPlaceholder: 'you@example.com',
  optional: 'optional',
  // Shown on the two fields that are NOT optional but sit next to ones that
  // are, so the asymmetry is readable at a glance (86eyke279).
  required: 'required',

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
  nameError: 'Add your name so we can save your spot.',
  emailError: "That email doesn't look right. Mind checking it?",
  // 86eyke279 (visual QA): the old copy read "…including the country code",
  // which accuses someone who pasted `+44 7911 123456` into an NL-selected
  // field of leaving out the very thing they typed. The selector does not
  // follow a pasted country code, so naming the selector is accurate for BOTH
  // failure modes — an incomplete national number and a right number under the
  // wrong flag.
  phoneError: "That number doesn't look right. Check it, and make sure the country selector matches it.",
  // Missing-vs-malformed are deliberately different messages (86eyke279): an
  // empty field is not a typo, and "check your email" reads as nonsense when
  // there is nothing to check.
  emailRequired: 'Add your email so the organizer can reach you.',
  phoneRequired: 'Add your phone number so the door can find you.',
  // Cloudflare Turnstile permanently failed to load (86ey2czr6) — most often
  // an ad-blocker dropping the challenges.cloudflare.com script.
  turnstileFailed: "Verification couldn't load. Disable your ad-blocker or try a different browser, then refresh to submit.",

  // ── Success ──────────────────────────────────────────────────────────────
  successTitle: "Request sent. You're in the queue.",
  // "Nice one, {name}." with the name in a styled span, then optional "(+{n})",
  // then the review line; split so the name + +N keep their own styling.
  successGreetPre: 'Nice one, ',
  successPlus: '(+{n})',
  successReview: '. {event} is reviewing your spot. We\'ll sort the rest at the door.',
  successInfo: 'No need to screenshot this. We check you in by name at the door.',
  successReset: 'Add someone else',

  // ── Auto-approved success (the link put them straight on the list) ───────
  approvedTitle: "You're on the list. Done deal.",
  approvedReview: ". You're on the list for {event}. Say your name at the door and you're in.",

  // ── Status link (save-for-later) + /r/[token] page ───────────────────────
  statusSaveTitle: 'Save your status link',
  statusSaveSub: 'Check where your request stands, anytime.',
  statusCopy: 'Copy link',
  statusCopied: 'Copied!',
  statusPendingTitle: "You're in the queue.",
  statusPendingBody: '{event} is reviewing your request. Check back here anytime.',
  statusApprovedTitle: "You're on the list.",
  statusApprovedBody: 'Say your name at the door of {event} on {date}. No ticket needed, your name is the ticket.',
  statusApprovedGroup: 'Party of {n} — all under your name.',
  statusDeniedTitle: 'Not this time.',
  statusDeniedBody: "Your request for {event} wasn't approved. The door has the final say tonight.",
  statusNotFoundTitle: 'Nothing here.',
  statusNotFoundBody: "This status link isn't valid (anymore). Request a spot through the event link.",

  // ── Closed / unknown slug ────────────────────────────────────────────────
  closedTitle: 'The list is closed.',
  closedBody: "This sign-up link isn't active anymore. Ask the organizer for a fresh one.",

  // ── Full (a capped link with 0 spots left, #43) ──────────────────────────
  fullTitle: 'The list is full.',
  fullBody: 'No spots left on this link. Spots free up when plans change, so try again later.',

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: 'Guest list, handled by PlusOne',
} as const;
