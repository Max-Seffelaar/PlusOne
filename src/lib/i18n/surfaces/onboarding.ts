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
    kvkVatLabel: 'Company (KVK) / VAT (optional)',
    kvkVatPlaceholder: 'NL••• ••• B••',
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
    submit: 'Create venue',
  },
} as const;
