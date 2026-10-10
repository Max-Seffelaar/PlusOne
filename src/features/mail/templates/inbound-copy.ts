// Auto-reply copy for mail sent to noreply@ (Gastcommunicatie F, z8uq9m2vpy).
// NOT in docs/copy-review/guest-mails.html: three variants per string are in
// the PR body under "Copy choices" (docs/copy-prompt.md); this is the pick.
// Plain strings with {placeholders}, filled and escaped by ../inbound.ts.
// tests/unit/no-em-dash-in-copy.test.ts scans this file.

export const inboundCopy = {
  subject: 'This address does not take replies',
  known: 'This address does not take replies. To reach {company}, mail {contact_email}.',
  unknown:
    "This address does not take replies. The email you got names who to contact at the bottom, under Questions.",
  signoff: 'PlusOne',
};
