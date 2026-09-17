/**
 * Onboarding surface copy (venue creation). EN-only; voice + rules in
 * tone-of-voice.md, string deck in copy-deck.md §11. Sentence case, numerals,
 * no em-dash habit, glossary terms exact (Venue, Admin, VAT, Data retention).
 */
export const onboarding = {
  venueCreate: {
    title: 'New venue',
    introPre: 'You make a new venue and become its ',
    introBold: 'Admin',
    introPost: ' automatically. Your account stays yours, separate from your other venues.',
    companyNameLabel: 'Venue name',
    companyNamePlaceholder: 'e.g. LOFI',
    cityLabel: 'City',
    cityPlaceholder: 'Amsterdam',
    venueTypeLabel: 'Venue type',
    typeClub: 'Club',
    typeFestival: 'Festival',
    typeBar: 'Bar',
    typeConcert: 'Concert hall',
    kvkLabel: 'Company number (KVK, optional)',
    kvkPlaceholder: '12345678',
    retentionLabel: 'Data retention',
    retentionNote: 'Guest data is anonymized to “Guest #X” after this period. Default 12 months, 1 minimum.',
    retentionMonths: '{n} mo',
    billingLabel: 'Billing',
    billingNotePre: 'Every venue gets its own subscription, and yours starts in ',
    billingNoteBold1: 'onboarding',
    billingNoteMid: '. Leave your billing details and finish payment later. Pilots can run on ',
    billingNoteBold2: 'comped',
    billingNotePost: '.',
    billingEmailLabel: 'Billing email',
    billingEmailPlaceholder: 'billing@venue.com',
    vatLabel: 'VAT (optional)',
    vatPlaceholder: 'NL000000000B00',
    paymentNote: "We never store your IBAN or card details. The payment provider handles that (SEPA Direct Debit / iDEAL).",
    /** The venue WAS created; only the follow-up active-venue switch was refused
     *  (86eykm7rk). Never reuse `venue.switchFailed` here: telling someone they
     *  have lost access to the venue they just made is false, and its "refresh
     *  your venues" advice points at a list that does contain it. */
    createdNotOpened: 'Venue created, but we could not open it. You’ll find it under More → Venues.',
    submit: 'Create venue',
    submitBusy: 'Working…',
    // Consent (#40) — split so the Terms/Privacy words can be links.
    consentPre: 'I agree to the ',
    consentTerms: 'Terms',
    consentMid: ' and ',
    consentPrivacy: 'Privacy Policy',
    consentPost: '.',
  },
} as const;
