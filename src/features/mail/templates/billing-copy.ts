// Billing-mail copy (Billing-mails B1, z8uq9m2z19): copy v3, final picks by
// Max on 2026-10-09 (docs/copy-review/billing-mails.html). Taken over word for
// word; change it only through a new copy review. Plain strings with
// {placeholders}, filled and escaped by ./billing-mails.ts:
//   {first_name}      the recipient's first name ("Hi there" without one)
//   {company}         the company name
//   {trial_end_date}  the effective trial end, Amsterdam calendar day
// No amounts anywhere (prices live in Stripe) and no dynamic counts.
// Kept outside src/lib/i18n because it is mail copy for one feature with a
// fixed review trail; tests/unit/no-em-dash-in-copy.test.ts scans this file.

import type { BillingMailType } from '@/features/billing/mail-schedule';

export interface BillingMailCopy {
  subject: string;
  preheader: string;
  heading: string;
  paragraphs: string[];
  button: string;
  /** Where the button goes, relative to the app origin. Always a web page. */
  path: string;
  /** Adds "Stripe sends your invoices separately." to the footer. */
  invoicesLine: boolean;
}

export const billingMailShared = {
  greeting: 'Hi {first_name},',
  greetingNoName: 'Hi there,',
  linkFallback: 'Button not working? Open {cta_url}',
  footerReason: "You got this email because you're an admin or in finance at {company} on PlusOne.",
  footerReply: 'Reply to this email with any question. It goes straight to the PlusOne team.',
  stripeInvoices: 'Stripe sends your invoices separately.',
};

const BILLING_PATH = '/app/billing';

export const billingMailCopy: Record<BillingMailType, BillingMailCopy> = {
  billing_trial_day0: {
    subject: "You're in. {company} is on PlusOne",
    preheader: 'Your Pro trial runs until {trial_end_date}.',
    heading: "Let's fill your first list",
    paragraphs: [
      '{company} is live on PlusOne, and your Pro trial runs until {trial_end_date}. You get every feature while it lasts.',
      'Create an event and send your team an invite. The list fills from there.',
      "Payment can wait until you're ready. You set it up in Billing, in your browser: monthly, or yearly with 20% off. Card, SEPA Direct Debit, and iDEAL all work.",
    ],
    button: 'Create your first event',
    path: '/app/events/new',
    invoicesLine: false,
  },
  billing_trial_day7: {
    subject: 'Keep PlusOne after {trial_end_date}?',
    preheader: 'Your trial for {company} ends in 7 days.',
    heading: 'Staying with PlusOne?',
    paragraphs: [
      'Your trial for {company} ends in 7 days, on {trial_end_date}. To keep creating events and inviting your team after that, set up payment in Billing.',
      "There's one plan, Pro. Pay monthly, or yearly with 20% off, by card, SEPA Direct Debit, or iDEAL.",
      'Not ready to decide? Your planned events and the door keep running either way. Reply to this email if you want to talk it through.',
    ],
    button: 'Set up payment',
    path: BILLING_PATH,
    invoicesLine: false,
  },
  billing_trial_day12: {
    subject: 'Your trial ends in 2 days',
    preheader: 'After {trial_end_date}, new events and invites pause until payment is set up.',
    heading: '2 days left on your trial',
    paragraphs: [
      'The PlusOne trial for {company} ends on {trial_end_date}.',
      "If payment isn't set up by then, you can't create new events, invite people, or import contacts. Events you already planned keep running, and so does the door.",
      'Set up payment in Billing, in your browser.',
    ],
    button: 'Set up payment',
    path: BILLING_PATH,
    invoicesLine: false,
  },
  billing_trial_ended: {
    subject: 'Your PlusOne trial has ended',
    preheader: 'Your door and planned events keep running. New events are paused.',
    heading: 'Your trial has ended',
    paragraphs: [
      'The trial for {company} ended on {trial_end_date}.',
      'Still working: the door, the events you already planned, their guest lists, and all your data.',
      'Paused: new events, team invites, and imports.',
      'Set up payment in Billing and the paused features come back.',
    ],
    button: 'Set up payment',
    path: BILLING_PATH,
    invoicesLine: false,
  },
  billing_trial_day21: {
    subject: 'Was something missing in PlusOne?',
    preheader: "Your trial ended a week ago. Tell us what didn't work.",
    heading: 'Did PlusOne fit {company}?',
    paragraphs: [
      "Your trial ended on {trial_end_date}. If something didn't work for {company}, reply to this email and tell us what it was.",
      'Ready to carry on? Set up payment in Billing and new events open up again. Your planned events and your data are untouched.',
      'This is our last email about your trial.',
    ],
    button: 'Set up payment',
    path: BILLING_PATH,
    invoicesLine: false,
  },
  billing_payment_failed: {
    subject: "Your PlusOne payment didn't go through",
    preheader: 'Update your payment method in Billing.',
    heading: "Your payment didn't go through",
    paragraphs: [
      "We couldn't collect the latest payment for the PlusOne subscription of {company}.",
      'Please update your payment method in Billing. Nothing is paused right now, and your events keep running.',
    ],
    button: 'Update payment method',
    path: BILLING_PATH,
    invoicesLine: true,
  },
  billing_canceled: {
    subject: 'Your PlusOne subscription has ended',
    preheader: 'Your data and planned events stay. You can reactivate any time.',
    heading: 'Your subscription has ended',
    paragraphs: [
      'The PlusOne subscription for {company} has ended.',
      'Your data stays, and the events you already planned keep running, door included. New events, team invites, and imports are paused.',
      'Want to come back? Reactivate billing and the paused features open up again.',
    ],
    button: 'Reactivate billing',
    path: BILLING_PATH,
    invoicesLine: true,
  },
};
