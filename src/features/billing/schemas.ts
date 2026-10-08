// Zod schemas for the billing/onboarding mutations (CLAUDE.md: all input through
// Zod). The interval enum is derived from BILLING_INTERVALS so the picker, the
// action and the validation can never drift.

import { z } from 'zod';
import { BILLING_INTERVALS } from './plans';

const uuid = z.string().uuid('Invalid id');

export const completeOnboardingSchema = z.object({
  venueId: uuid,
});
export type CompleteOnboardingInput = z.input<typeof completeOnboardingSchema>;

// Checkout/portal take ONLY the venue id (+ the interval for checkout) — the
// plan is always Pro, the subscription is read server-side from the venue's
// own row (never trusted from the client), and the URLs are server-built. (#32)
export const billingSessionSchema = z.object({
  venueId: uuid,
});
export type BillingSessionInput = z.input<typeof billingSessionSchema>;

export const checkoutSessionSchema = billingSessionSchema.extend({
  interval: z.enum(BILLING_INTERVALS),
});
export type CheckoutSessionActionInput = z.input<typeof checkoutSessionSchema>;

// Platform-admin trial management (Billing G). The venue id and the date are
// all the client supplies; the RPCs re-check is_platform_admin() and the range.
export const platformTrialEndSchema = z.object({
  venueId: uuid,
  // A calendar day (YYYY-MM-DD) from a date input; the action sets the end of
  // that day in Europe/Amsterdam, so "Trial until 31 Oct" includes the 31st.
  trialEndsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
});
export type PlatformTrialEndInput = z.input<typeof platformTrialEndSchema>;

export const platformCompedSchema = z.object({
  venueId: uuid,
  comped: z.boolean(),
});
export type PlatformCompedInput = z.input<typeof platformCompedSchema>;
