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
  /** Stands in for {inviter} when the inviter has no name on their profile. */
  inviterFallback: 'A teammate',

  teamJoin: {
    subject: '{inviter} invited you to join {company}',
    heading: "You're invited to {company}",
    body: "{inviter} added you to the {company} team on PlusOne. Log in with this email address and you're in. The invite is open for 7 days.",
  },

  teamAddedToEvent: {
    subject: '{inviter} added you to {event}',
    heading: "You're on the crew for {event}",
    body: '{inviter} added you to the crew for {event} at {company}. Log in with this email address to see the event.',
  },

  teamResendJoin: {
    subject: 'Reminder: {inviter} invited you to join {company}',
    heading: 'Your invite to {company} is still open',
    body: '{inviter} sent your invite again. Log in with this email address to join the {company} team. The invite is open for 7 days.',
  },

  teamResendEvent: {
    subject: "Reminder: you're on the crew at {company}",
    heading: "You're on the crew at {company}",
    body: '{inviter} sent you a reminder. Log in with this email address to see your events at {company}.',
  },

  cta: 'Log in to PlusOne',
  linkFallback: 'Button not working? Open {url}',
  footerReason:
    "You got this email because this address was added to {company} on PlusOne. Not expecting it? You can ignore it.",
  footerSupport: 'Questions? Mail support@plus-one.io.',
};
