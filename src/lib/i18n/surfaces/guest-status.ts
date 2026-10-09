/**
 * Guest status page (`/s/[token]`) and opt-out page (`/u/[token]`) copy
 * (Gastcommunicatie F, z8uq9m2vpy). Reached from a guest mail. Dial = low
 * wink, clear and exact (tone-of-voice.md: guest e-mail about their own spot).
 * Not in docs/copy-review/guest-mails.html: three variants per string are in
 * the PR body under "Copy choices"; these are the picks. The spot line, price
 * line and calendar labels reuse the mail copy (guest-copy.ts) so page and
 * mail say the same thing.
 */
export const guestStatus = {
  pageTitle: 'Your spot · PlusOne',
  onListTitle: "You're on the list",
  onListBody: 'Give your name at the door. No QR code or screenshot needed.',
  checkedInTitle: "You're in",
  checkedInBody: 'You checked in at the door. Have a good night.',
  offListTitle: "You're not on the list",
  offListBody: "This spot isn't on the guest list anymore.",
  canceledTitle: 'This event is canceled',
  canceledBody: "It won't go ahead, so the guest list is closed too.",
  houseRulesLabel: 'House rules',
  calendarLabel: 'Add to calendar',
  contactLabel: 'Questions?',
  contactBody: 'Mail {company} at {contact_email}.',
  channelPhone: 'Phone',
  channelInstagram: 'Instagram',
  channelFacebook: 'Facebook',
  channelSnapchat: 'Snapchat',
  channelTiktok: 'TikTok',
  channelWebsite: 'Website',
  unsubscribe: {
    pageTitle: 'Email updates · PlusOne',
    title: 'Stop email updates?',
    body: "You won't get emails from this company about your guest list spots. You stay on the list.",
    confirm: 'Stop updates',
    doneTitle: 'Updates stopped',
    doneBody: "You won't get these emails anymore. You stay on the list.",
    throttled: 'Too many tries from this network. Try again in a few minutes.',
  },
} as const;
