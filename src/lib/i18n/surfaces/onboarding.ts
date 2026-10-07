/**
 * Onboarding surface copy (company creation). EN-only; voice + rules in
 * tone-of-voice.md, string deck in copy-deck.md §11. Sentence case, numerals,
 * no em-dash habit, glossary terms exact (Company, Admin, VAT, Data retention).
 */
export const onboarding = {
  venueCreate: {
    title: 'New company',
    introPre: 'You make a new company and become its ',
    introBold: 'Admin',
    introPost: ' automatically. Your account stays yours, separate from your other companies.',
    companyNameLabel: 'Company name',
    companyNamePlaceholder: 'e.g. LOFI',
    cityLabel: 'City',
    cityPlaceholder: 'Amsterdam',
    venueTypeLabel: 'Type',
    // Type options, in this order (decision Max + Joeri 2026-10-06). Stored as
    // venues.settings.venue_type: `club`/`festival`/`bar`/`concertzaal`/`venue`/`organizer`.
    typeClub: 'Club',
    typeFestival: 'Festival',
    typeBar: 'Bar',
    typeConcert: 'Concert hall',
    typeVenue: 'Venue',
    typeOrganizer: 'Organizer',
    kvkLabel: 'Company number (KVK, optional)',
    kvkPlaceholder: '12345678',
    retentionLabel: 'Data retention',
    retentionNote: 'Guest data is anonymized to “Guest #X” after this period. Default 12 months, 1 minimum.',
    retentionMonths: '{n} mo',
    billingLabel: 'Billing',
    billingNotePre: 'Every company gets its own subscription, and yours starts in ',
    billingNoteBold1: 'onboarding',
    billingNoteMid: '. Leave your billing details and finish payment later. Pilots can run on ',
    billingNoteBold2: 'comped',
    billingNotePost: '.',
    billingEmailLabel: 'Billing email',
    billingEmailPlaceholder: 'billing@company.com',
    vatLabel: 'VAT (optional)',
    vatPlaceholder: 'NL000000000B00',
    paymentNote: "We never store your IBAN or card details. The payment provider handles that (SEPA Direct Debit / iDEAL).",
    /** The company WAS created; only the follow-up active-company switch was refused
     *  (86eykm7rk). Never reuse `venue.switchFailed` here: telling someone they
     *  have lost access to the company they just made is false, and its "refresh
     *  your companies" advice points at a list that does contain it. */
    createdNotOpened: 'Company created, but we could not open it. You’ll find it under More → Companies.',
    submit: 'Create company',
    submitBusy: 'Working…',
    // Consent (#40) — split so the Terms/Privacy words can be links.
    consentPre: 'I agree to the ',
    consentTerms: 'Terms',
    consentMid: ' and ',
    consentPrivacy: 'Privacy Policy',
    consentPost: '.',
  },

  // Onboarding wizard, store-review demo account (86ey6bfug): the company step
  // shows the refusal (t.auth.demoNoVenues) and this way out instead of a form.
  demo: {
    backToApp: 'Back to the app',
  },

  // Onboarding wizard, step 3: invite the team (TeamStep). The other wizard
  // steps still carry their copy inline.
  teamStep: {
    panelTitle: 'Better with your team',
    panelSub: 'Give hosts and managers access with the right roles and quota.',
    panelBullet1: 'Roles decide who can do what',
    panelBullet2: 'You can invite people later too',
    panelBullet3: 'Team members get their own magic link by email',
    heading: 'Invite your team',
    sub: 'Add hosts and managers. Or skip and do it later from Team.',
    roleLabel: 'Role',
    roleManager: 'Manager',
    roleHost: 'Host',
    remove: 'Remove',
    emailPlaceholder: 'name@company.com',
    addRow: 'Add another team member',
    send: 'Send invites',
    working: 'Working…',
    // Joeri walkthrough: a bare "Skip" under a disabled primary was easy to miss.
    skip: 'Skip for now',
    skipHintPre: 'You can add your team later from ',
    skipHintBold: 'Team',
    skipHintPost: '.',
    sendError: "Couldn't send the invite.",
    finishError: "Couldn't finish setting up. Try again.",
  },

  // Someone with no company yet but an open invite, team or crew (z8uq9m2yvp):
  // each one is accepted or declined here, never at login, instead of being sent
  // into company setup. Shown before the wizard.
  invites: {
    badge: 'Invite',
    headingOne: "You've been invited",
    headingMany: 'You have {n} invites',
    sub: 'Accept to join. The company only sees your details once you accept.',
    ownCompany: 'Set up my own company instead',
    /** After the last invite is declined: the way on is company setup. */
    ownCompanyAfter: 'Set up my own company',
  },
} as const;
