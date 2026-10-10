// Guest-mail copy (Gastcommunicatie F, z8uq9m2vpy): copy v3, final picks by
// Max on 2026-10-09 (docs/copy-review/guest-mails.html: guest-on-list A,
// guest-plus-ones A, guest-event-changed A, guest-event-canceled A,
// guest-removed A, guest-reminder A, request-approved A, request-partly B,
// request-declined B; price line A, status link B, footer A). Taken over word
// for word; change it only through a new copy review. Plain strings with
// {placeholders}, filled and escaped by ./guest-mails.ts:
//   {guest_first_name} {event_name} {event_date} {event_time} {location}
//   {tier_name} {tier_price} {n} (the +N) {total} (people incl. the guest)
//   {people} ("1 person" / "4 people") {asked} {remark} {house_rules}
//   {company} {contact_email} {status_url}
// No company name in a subject or a body line: the event name is what guests
// recognise; the company appears in the footer only. No amount is ever
// written into the copy: {tier_price} comes from the tier.
// Kept outside src/lib/i18n like the billing-mail copy (one feature, a fixed
// review trail); tests/unit/no-em-dash-in-copy.test.ts scans this file.

export type GuestMailType =
  | 'guest_on_list'
  | 'guest_plus_ones'
  | 'guest_event_changed'
  | 'guest_event_canceled'
  | 'guest_removed'
  | 'guest_reminder'
  | 'guest_request_approved'
  | 'guest_request_partly'
  | 'guest_request_declined';

export const GUEST_MAIL_TYPES: readonly GuestMailType[] = [
  'guest_on_list',
  'guest_plus_ones',
  'guest_event_changed',
  'guest_event_canceled',
  'guest_removed',
  'guest_reminder',
  'guest_request_approved',
  'guest_request_partly',
  'guest_request_declined',
];

/** One line in three forms: no plus-ones, exactly one, two or more. */
export interface ByPlusOnes {
  none: string;
  one: string;
  many: string;
}

export const guestMailShared = {
  sender: '{event_name} via PlusOne',
  greeting: 'Hi {guest_first_name},',
  greetingNoName: 'Hi there,',
  when: '{event_date} · Doors {event_time}',
  person: '1 person',
  people: '{total} people',
  tierLine: {
    none: '{tier_name} · 1 person',
    one: '{tier_name} · You +{n} ({total} people)',
    many: '{tier_name} · You +{n} ({total} people)',
  } satisfies ByPlusOnes,
  priceSingle: 'Entry: {tier_price}, pay at the door',
  pricePerPerson: 'Entry per person: {tier_price}, pay at the door',
  priceForTier: 'Entry per person for {tier_name}: {tier_price}, pay at the door',
  spotTotal: 'Your spot: {people}',
  tierCount: '{tier_name}: {people}',
  calendarLead: 'Add to calendar:',
  calendarIcs: 'Apple or Outlook (.ics)',
  calendarGoogle: 'Google Calendar',
  houseRules: 'House rules: {house_rules}',
  note: 'Note from the team: "{remark}"',
  statusButton: 'Check your status',
  statusFallback: 'Button not working? Open {status_url}',
  reasonOnList: "You got this email because you're on the guest list for {event_name}.",
  reasonWasOnList: 'You got this email because you were on the guest list for {event_name}.',
  reasonAsked: 'You got this email because you asked for a spot on the guest list for {event_name}.',
  questions: 'Questions? Mail {company} at {contact_email}, or reply to this email.',
  unsubscribeLead: "Don't want updates from {company}?",
  unsubscribeLink: 'Unsubscribe',
  unsubscribeStay: 'You stay on the list.',
  trouble: 'Trouble with this email? support@plus-one.io',
};

/** The building blocks of a mail body, in the order the copy deck shows them. */
export type GuestMailBlock = 'intro' | 'note' | 'details' | 'calendar' | 'after' | 'houseRules' | 'status';

export interface GuestMailCopy {
  subject: string | ByPlusOnes;
  preheader: string | ByPlusOnes;
  intro: string | ByPlusOnes;
  /** The closing line(s) after the details, if any. */
  after?: string;
  blocks: GuestMailBlock[];
  reason: 'onList' | 'wasOnList' | 'asked';
  /** Unsubscribe line ends in "You stay on the list." (only where a spot exists). */
  staysOnList: boolean;
  /** The note is always shown (removed, partly, declined) vs only when written. */
  noteRequired: boolean;
}

export const guestMailCopy: Record<GuestMailType, GuestMailCopy> = {
  guest_on_list: {
    subject: "You're on the list for {event_name}",
    preheader: '{event_date}, doors {event_time}. Give your name at the door.',
    intro: "You're on the guest list for {event_name}.",
    after: "At the door, give your name. You don't need a QR code or a screenshot.",
    blocks: ['intro', 'details', 'calendar', 'after', 'houseRules', 'status'],
    reason: 'onList',
    staysOnList: true,
    noteRequired: false,
  },
  guest_plus_ones: {
    subject: 'Your spot for {event_name} changed',
    preheader: {
      none: "You're now on the list without a plus-one.",
      one: "You're now on the list with +{n}.",
      many: "You're now on the list with +{n}.",
    },
    intro: {
      none: "Your spot for {event_name} changed. You're now on the list without a plus-one.",
      one: "Your spot for {event_name} changed. You're now on the list with +{n}, so {total} people in total.",
      many: "Your spot for {event_name} changed. You're now on the list with +{n}, so {total} people in total.",
    },
    after: 'Everything else stays the same. Give your name at the door.',
    blocks: ['intro', 'note', 'details', 'calendar', 'after', 'status'],
    reason: 'onList',
    staysOnList: true,
    noteRequired: false,
  },
  guest_event_changed: {
    subject: 'New details for {event_name}',
    preheader: '{event_date}, doors {event_time}, {location}.',
    intro: {
      none: "{event_name} has new details. You're still on the list.",
      one: "{event_name} has new details. You're still on the list with +{n}.",
      many: "{event_name} has new details. You're still on the list with +{n}.",
    },
    after: 'Give your name at the door, as planned.',
    blocks: ['intro', 'details', 'calendar', 'after', 'status'],
    reason: 'onList',
    staysOnList: true,
    noteRequired: false,
  },
  guest_event_canceled: {
    subject: '{event_name} is canceled',
    preheader: "{event_name} on {event_date}, doors {event_time}, won't go ahead.",
    intro:
      '{event_name} on {event_date} (doors {event_time}) is canceled. Your spot on the guest list is canceled with it.',
    blocks: ['intro', 'note'],
    reason: 'wasOnList',
    staysOnList: false,
    noteRequired: false,
  },
  guest_removed: {
    subject: "You're no longer on the list for {event_name}",
    preheader: 'A note about your spot for {event_date}.',
    intro: {
      none: "You're off the guest list for {event_name} on {event_date}, doors {event_time}.",
      one: "You're off the guest list for {event_name} on {event_date}, doors {event_time}. Your +1 is off the list too.",
      many: "You're off the guest list for {event_name} on {event_date}, doors {event_time}. Your +{n} are off the list too.",
    },
    blocks: ['intro', 'note'],
    reason: 'wasOnList',
    staysOnList: false,
    noteRequired: true,
  },
  guest_reminder: {
    subject: "Reminder: you're on the list for {event_name}",
    preheader: '{event_date}, doors {event_time}, {location}.',
    intro: "You're on the list for {event_name}.",
    blocks: ['intro', 'details', 'calendar', 'status'],
    reason: 'onList',
    staysOnList: true,
    noteRequired: false,
  },
  guest_request_approved: {
    subject: "You're on the list for {event_name}",
    preheader: {
      none: 'Your request is approved for {event_date}.',
      one: 'Your request is approved. {total} people, {event_date}.',
      many: 'Your request is approved. {total} people, {event_date}.',
    },
    intro: {
      none: "Your request is approved. You're on the guest list for {event_name}.",
      one: "Your request is approved. You're on the guest list for {event_name}, {total} people in total.",
      many: "Your request is approved. You're on the guest list for {event_name}, {total} people in total.",
    },
    after: 'Give your name at the door.',
    blocks: ['intro', 'details', 'note', 'calendar', 'after', 'status'],
    reason: 'asked',
    staysOnList: true,
    noteRequired: false,
  },
  guest_request_partly: {
    subject: 'On the list for {event_name}: {people}',
    preheader: "Not the full group, but you're on the list.",
    intro:
      "You're on the list for {event_name}. We couldn't fit all {asked} people you asked for, so your spot covers {people}.",
    after: 'Give your name at the door.',
    blocks: ['intro', 'note', 'details', 'calendar', 'after', 'status'],
    reason: 'asked',
    staysOnList: true,
    noteRequired: true,
  },
  guest_request_declined: {
    subject: 'Your guest list request for {event_name}',
    preheader: 'An answer about {event_name} on {event_date}.',
    intro:
      "Thanks for your request for {event_name} on {event_date}, doors {event_time}. We can't add you to the guest list this time.",
    after: 'Questions? Mail {contact_email}.',
    blocks: ['intro', 'note', 'after'],
    reason: 'asked',
    staysOnList: false,
    noteRequired: true,
  },
};
