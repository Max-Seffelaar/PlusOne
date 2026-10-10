// Team notification mail copy (Gastcommunicatie F, PR 6b, z8uq9m2vpy). The ★
// variants from the PR's "Copy choices" table, written to tone-of-voice.md and
// docs/copy-prompt.md: app tone, low wink, numbers exact, no guest data beyond
// a first name and +N. Placeholders are filled by fmt() in team-notify.ts.
// Mail copy lives here (like guest-copy.ts), not in src/lib/i18n: it is never
// rendered in the app. Guarded by no-em-dash-in-copy.test.ts.

export const teamNotifyCopy = {
  greeting: 'Hi {first_name},',
  greetingNoName: 'Hi,',

  request: {
    subject: '{guest_first_name} asked for a spot at {event_name}',
    subjectNoName: 'New request for {event_name}',
    intro: '{guest_first_name} asked for a spot on the list for {event_name}: {people}.',
    introNoName: 'Someone asked for a spot on the list for {event_name}: {people}.',
    subjectMany: '{count} new requests for {event_name}',
    introMany: '{count} requests for {event_name} came in over the last hour.',
    // A bundle over more than one event (review #458 S3).
    subjectManyEvents: '{count} new requests at {company}',
    introManyEvents: '{count} requests for events at {company} came in over the last hour.',
    button: 'Review requests',
  },
  quota: {
    subject: '{requester} wants {extra} more guests for {event_name}',
    intro: '{requester} asked for {extra} extra guest spots for {event_name}.',
    subjectMany: '{count} quota requests for {event_name}',
    introMany: '{count} quota requests for {event_name} came in over the last hour.',
    subjectManyEvents: '{count} quota requests at {company}',
    introManyEvents: '{count} quota requests for events at {company} came in over the last hour.',
    button: 'Review quota request',
  },
  decision: {
    approvedSubject: 'You got {extra} more guests for {event_name}',
    approvedIntro: 'Your request for {extra} extra guest spots for {event_name} is approved. They are yours to use now.',
    deniedSubject: 'Your quota request for {event_name}',
    deniedIntro: "Your request for {extra} extra guest spots for {event_name} wasn't approved this time.",
    button: 'Open PlusOne',
  },
  digest: {
    subject: '{total} open requests waiting',
    subjectOne: '1 open request waiting',
    intro: "Here's what is still waiting for a decision.",
    eventLine: '{event_name}, {event_date}',
    requestsOne: '1 guest request',
    requestsMany: '{n} guest requests',
    quotaOne: '1 quota request',
    quotaMany: '{n} quota requests',
    button: 'Review requests',
  },

  when: '{event_date} · Doors {event_time}',
  reason: 'You get this because of your notification settings in PlusOne.',
  settings: 'Change them in your profile',
  unsubscribeLead: "Don't want these emails?",
  unsubscribeLink: 'Stop them',
  trouble: 'Trouble with this email? support@plus-one.io',
} as const;
