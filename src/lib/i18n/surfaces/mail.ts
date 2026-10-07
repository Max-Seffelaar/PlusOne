/**
 * Team mail copy (Mail-infra F0, z8uq9m2yvt): the e-mails the app itself sends
 * through Resend to an EXISTING account. New accounts still get Supabase's own
 * invite template (#20); that copy lives in the Supabase dashboard, not here.
 *
 * Audience: someone a company admin just added. Dial = low wink, clarity
 * first: who invited you, to what, and the one thing to do (log in). Never a
 * login token in the mail, only the plain /login URL.
 *
 * Rendering rules live in `src/features/mail/templates.ts`: {placeholders} are
 * filled with `fmt`, HTML-escaped in the body, control characters stripped in
 * the subject (plain text, no entities). Composed into the central dictionary
 * as `t.mail.*` so the no-em-dash guard covers it like any other copy.
 */
export const mail = {
  /** Stands in for {inviter} when the inviter has no name on their profile.
   *  Sentence-initial uses are capitalised by the renderer. */
  inviterFallback: 'an admin at {company}',

  gettingIn: 'Getting in',
  /** Rendered as a real <ol> in HTML and numbered in the text version. */
  loginSteps: [
    'Tap Log in to PlusOne.',
    'Enter this email address.',
    "We'll send you a 6-digit code. Enter it and you're in.",
  ],

  // Shared paragraphs after the steps.
  joinBanner: 'Already logged in? Open PlusOne and accept the invite in the banner at the top.',
  joinSwitch:
    'On more than one team? {company} sits next to your other companies. On your phone, go to More and tap the company card at the top. On a computer, use the company card at the top of the sidebar.',
  joinOpenFor: 'The invite is open for 7 days.',
  crewFindEvent:
    'Find the event. Switch to {company}: on your phone, go to More and tap the company card at the top. On a computer, use the company card at the top of the sidebar.',
  crewFindEvents:
    'Find your events. Switch to {company}: on your phone, go to More and tap the company card at the top. On a computer, use the company card at the top of the sidebar.',
  crewScope:
    'You only see the events {company} put you on. Need another event or more guest spots? Ask {inviter}. They make the changes.',
  /** Only when the crew member has a guest quota (> 0) on the event. */
  crewQuota: 'You can put up to {n} guests on the list.',
  crewQuotaOne: 'You can put up to 1 guest on the list.',

  teamJoin: {
    subject: '{inviter} invited you to join {company}',
    heading: "You're invited to {company}",
    intro: "{inviter} added you to the {company} team on PlusOne. You already have a login, so there's nothing new to set up.",
  },

  teamAddedToEvent: {
    subject: '{inviter} added you to {event}',
    heading: "You're on the crew for {event}",
    intro: '{inviter} added you to the crew for {event} at {company}.',
  },

  teamResendJoin: {
    subject: 'Reminder: {inviter} invited you to join {company}',
    heading: 'Your invite to {company} is still open',
    intro: '{inviter} sent your invite again.',
  },

  teamResendEvent: {
    subject: "Reminder: you're on the crew at {company}",
    heading: "You're on the crew at {company}",
    intro: "{inviter} sent you a reminder. You're still on the crew at {company}.",
  },

  cta: 'Log in to PlusOne',
  linkFallback: 'Button not working? Open {url}',
  footerReason:
    "You got this email because this address was added to {company} on PlusOne. Not expecting it? You can ignore it.",
  footerSupport: 'Questions? Mail support@plus-one.io.',
};
