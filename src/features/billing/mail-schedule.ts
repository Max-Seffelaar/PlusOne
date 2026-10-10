// Billing-mail schedule (Billing-mails B1, z8uq9m2z19; decisions Max
// 2026-10-09, copy v3). Pure and client-safe: the job
// (src/features/billing/mail-job.ts) asks it which trial mails are due, the
// Platform tab asks it which one comes next. No I/O, no clock of its own.
//
// Moments, all from the EFFECTIVE trial end (effectiveTrialEndsAt: the
// platform override when set, else created_at + 14 days), so an override such
// as the ADE trial moves them along:
//   billing_trial_day0    subscription created_at (trial start)
//   billing_trial_day7    trial end - 7 days
//   billing_trial_day12   trial end - 2 days
//   billing_trial_ended   trial end
//   billing_trial_day21   trial end + 7 days (the last trial mail)
//
// A mail is due for DUE_WINDOW_MS (24 hours) from its moment and never after:
// no catch-up mail. The job runs hourly between 08:00 and 20:59 Amsterdam, so
// every window holds at least twelve runs and one failed run costs nothing;
// a moment that is already more than 24 hours gone when a short override is
// set is skipped, as decided. "Once per company per type" is the database's
// job (billing_mail_deliveries), not this function's: it answers "is this
// type due right now", the ledger answers "did it already go".
//
// Who gets nothing: comped (never trialing), paused companies, anything that
// is not trialing (active, past_due, canceled: trial mails stop once paid).
// A trialing company with a Stripe subscription has set up payment, so it
// only ever gets the welcome mail. The two Stripe mails (payment failed,
// canceled) are event-driven and not scheduled here.

import { effectiveTrialEndsAt } from './plans';

export const TRIAL_MAIL_TYPES = [
  'billing_trial_day0',
  'billing_trial_day7',
  'billing_trial_day12',
  'billing_trial_ended',
  'billing_trial_day21',
] as const;

export const EVENT_MAIL_TYPES = ['billing_payment_failed', 'billing_canceled'] as const;

export type TrialMailType = (typeof TRIAL_MAIL_TYPES)[number];
export type EventMailType = (typeof EVENT_MAIL_TYPES)[number];
export type BillingMailType = TrialMailType | EventMailType;

export function isBillingMailType(value: unknown): value is BillingMailType {
  return (
    typeof value === 'string' &&
    ((TRIAL_MAIL_TYPES as readonly string[]).includes(value) || (EVENT_MAIL_TYPES as readonly string[]).includes(value))
  );
}

const DAY_MS = 86_400_000;
export const DUE_WINDOW_MS = DAY_MS;

/** Offset of each reminder from the effective trial end. */
const END_OFFSETS: Record<Exclude<TrialMailType, 'billing_trial_day0'>, number> = {
  billing_trial_day7: -7 * DAY_MS,
  billing_trial_day12: -2 * DAY_MS,
  billing_trial_ended: 0,
  billing_trial_day21: 7 * DAY_MS,
};

export interface BillingMailSubscription {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'comped';
  /** subscriptions.created_at = the trial start. */
  createdAt: string | Date;
  /** subscriptions.trial_ends_at, the platform override; null = default 14 days. */
  trialEndsAt: string | Date | null;
  /** A Stripe subscription exists: payment is set up. */
  stripeLinked: boolean;
  /** billing_mail_settings.paused. */
  paused: boolean;
}

export interface TrialMailMoment {
  type: TrialMailType;
  at: Date;
}

/** Every trial mail this subscription would get, with its moment, in order.
 *  Empty when no trial mail applies at all. */
export function trialMailMoments(sub: BillingMailSubscription): TrialMailMoment[] {
  if (sub.paused || sub.status !== 'trialing') return [];
  const start = new Date(sub.createdAt);
  if (Number.isNaN(start.getTime())) return [];
  const end = effectiveTrialEndsAt(sub.createdAt, sub.trialEndsAt);
  if (Number.isNaN(end.getTime())) return [];

  const moments: TrialMailMoment[] = [{ type: 'billing_trial_day0', at: start }];
  if (sub.stripeLinked) return moments;
  for (const type of TRIAL_MAIL_TYPES) {
    if (type === 'billing_trial_day0') continue;
    moments.push({ type, at: new Date(end.getTime() + END_OFFSETS[type]) });
  }
  return moments;
}

/** The trial mails due at `now`, in schedule order: each one whose moment
 *  has passed by less than DUE_WINDOW_MS. */
export function dueBillingMails(sub: BillingMailSubscription, now: Date): TrialMailType[] {
  const t = now.getTime();
  return trialMailMoments(sub)
    .filter((m) => t >= m.at.getTime() && t < m.at.getTime() + DUE_WINDOW_MS)
    .map((m) => m.type);
}

/** The next trial mail for the Platform timeline: the first one still due or
 *  ahead that has not gone out yet. null when nothing is left. */
export function nextBillingMail(
  sub: BillingMailSubscription,
  now: Date,
  alreadySent: ReadonlySet<string> = new Set()
): TrialMailMoment | null {
  const t = now.getTime();
  for (const m of trialMailMoments(sub)) {
    if (alreadySent.has(m.type)) continue;
    if (t < m.at.getTime() + DUE_WINDOW_MS) return m;
  }
  return null;
}
