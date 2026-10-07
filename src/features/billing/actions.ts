'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { t } from '@/lib/i18n';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { billing } from './provider';
import { effectiveTrialEndsAt, PLAN_ID, type BillingPrices } from './plans';
import {
  completeOnboardingSchema,
  billingSessionSchema,
  checkoutSessionSchema,
  type CompleteOnboardingInput,
  type BillingSessionInput,
  type CheckoutSessionActionInput,
} from './schemas';

// Onboarding-time billing writes. subscriptions has no authenticated INSERT/UPDATE
// path (Stripe/webhook writes only, #32): the company's trialing Pro row is
// created by create_venue_with_owner itself (20261008120000), so onboarding no
// longer has a plan step or a plan action (Billing G).

export type BillingActionResult = { ok: true } | MutationError;

/** Mark onboarding finished for a venue (sets venues.settings.onboarding.completed). */
export async function completeOnboardingAction(
  input: CompleteOnboardingInput
): Promise<BillingActionResult> {
  const parsed = completeOnboardingSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_onboarding_complete', { p_venue_id: venueId });
  if (error) return mapMutationError(error);

  revalidatePath('/', 'layout');
  revalidatePath('/app');
  return { ok: true };
}

// ── Checkout & customer portal (fase 13 PR 2, #32) ───────────────────────────
// Browser-only entry points (the native shell hides them — store-tax seam,
// isNativeShell). Both are Stripe-hosted redirects: the action returns a URL,
// the client navigates, no payment data ever touches our code.

export type BillingUrlResult = { ok: true; url: string } | MutationError;

const billingErr = (code: string, message: string): MutationError => ({
  ok: false,
  code,
  message,
});

/** Absolute origin for the success/cancel/return URLs — env first, then the
 *  request's forwarded host (Vercel always sets these). */
async function appOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/$/, '');
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:7000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** May the caller manage this venue's billing? Admin OR finance of THAT venue
 *  (decision 2026-10-06: billing rights = admin + finance). Read through the
 *  user-scoped client, so RLS is the proof: a user always reads their own
 *  membership row, a non-member reads nothing. A platform admin without a real
 *  membership there gets nothing either — billing stays the company's. */
async function callerMayManageBilling(venueId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return false;
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  const roles = data?.roles ?? [];
  return roles.includes('admin') || roles.includes('finance');
}

/**
 * Start Stripe Checkout for the venue's subscription. Admin or finance only;
 * the plan is always Pro, the interval (month|year) is the caller's pick, and
 * the price is found in Stripe by lookup key. The remaining app-side trial
 * (effectiveTrialEndsAt — the same rule as the gate) carries into Stripe as
 * trial_end. The fresh customer id is persisted
 * immediately (stamp_stripe_customer, service-role — second documented confined
 * usage besides the webhook) so a webhook can always match by customer.
 */
export async function createCheckoutSessionAction(
  input: CheckoutSessionActionInput
): Promise<BillingUrlResult> {
  const parsed = checkoutSessionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, interval } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!(await callerMayManageBilling(venueId))) return unauthorized();

  const supabase = await createClient();
  const [{ data: venue }, { data: sub }] = await Promise.all([
    supabase
      .from('venues')
      .select('name, company_name, vat_number, finance_email')
      .eq('id', venueId)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('status, created_at, trial_ends_at, stripe_customer_id, stripe_subscription_id')
      .eq('venue_id', venueId)
      .maybeSingle(),
  ]);
  if (!venue || !sub) return invalidInput('No subscription found for this venue.');

  // Invoicing soft-gate (feedback Rik 2026-09-24): the venue display name is
  // often not the legal entity name, so checkout must not silently fall back
  // to it (as the company object below still does for callers that bypass
  // this check). Real invoicing details are asked here, at the point the
  // trial actually converts to paid — not during onboarding.
  if (!venue.company_name) {
    return billingErr('invoicing_required', t.settings.billing.invoicingRequiredError);
  }

  if (sub.status === 'comped') {
    return billingErr('comped', 'This venue runs on a pilot agreement. Billing is handled by us.');
  }
  if (sub.stripe_subscription_id && sub.status !== 'canceled') {
    return billingErr(
      'already_subscribed',
      'There already is an active subscription. Manage it via the billing portal.'
    );
  }

  const origin = await appOrigin();
  let result: Awaited<ReturnType<typeof billing.createCheckoutSession>>;
  try {
    result = await billing.createCheckoutSession({
      venueId,
      planId: PLAN_ID,
      interval,
      company: {
        name: venue.company_name ?? venue.name,
        vatNumber: venue.vat_number ?? null,
        financeEmail: venue.finance_email ?? null,
      },
      customerEmail: ctx.user.email ?? '',
      existingCustomerId: sub.stripe_customer_id ?? null,
      trialEnd: sub.status === 'trialing' ? effectiveTrialEndsAt(sub.created_at, sub.trial_ends_at) : null,
      successUrl: `${origin}/app?billing=success`,
      cancelUrl: `${origin}/app?billing=canceled`,
    });
  } catch (err) {
    console.error('createCheckoutSession threw', { venueId, err });
    return billingErr('unavailable', "Billing isn't live yet. Try again later.");
  }

  if (!result.ok) {
    if (result.reason === 'misconfigured') {
      // The misconfiguration guard (moved here from config import time): Stripe
      // is on but has no active price under this interval's lookup key. Loud on
      // purpose — console.error is what the log drain alerts on.
      console.error('stripe checkout misconfigured: no active price for lookup key', { interval });
    }
    return billingErr('unavailable', "Billing isn't live yet. Try again later.");
  }

  // Persist a newly created customer id before redirecting: if the user
  // abandons checkout, a later session reuses the same Stripe customer, and
  // webhooks can match by customer id from the very first event.
  if (result.customerId !== sub.stripe_customer_id) {
    const service = createServiceClient();
    const { error } = await service.rpc('stamp_stripe_customer', {
      p_venue_id: venueId,
      p_stripe_customer_id: result.customerId,
    });
    if (error) {
      console.error('stamp_stripe_customer failed', { venueId, error: error.message });
      return mapMutationError(error);
    }
  }

  return { ok: true, url: result.url };
}

/**
 * Open the Stripe customer portal (payment method + invoices). Admin or finance;
 * requires that a checkout once created the Stripe customer.
 */
export async function createPortalSessionAction(
  input: BillingSessionInput
): Promise<BillingUrlResult> {
  const parsed = billingSessionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!(await callerMayManageBilling(venueId))) return unauthorized();

  const supabase = await createClient();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    return billingErr('no_customer', 'Set up your payment first. The portal opens after that.');
  }

  const origin = await appOrigin();
  let result: Awaited<ReturnType<typeof billing.createPortalSession>>;
  try {
    result = await billing.createPortalSession({
      customerId: sub.stripe_customer_id,
      returnUrl: `${origin}/app?billing=portal-return`,
    });
  } catch (err) {
    console.error('createPortalSession threw', { venueId, err });
    return billingErr('unavailable', "Billing isn't live yet. Try again later.");
  }
  if (!result.ok) return billingErr('unavailable', "Billing isn't live yet. Try again later.");
  return { ok: true, url: result.url };
}

// ── Prices (Billing G) ───────────────────────────────────────────────────────
// The two Pro prices, live from Stripe (provider-side cache). Browser only: the
// po Billing screen never asks inside the native shell (store-tax seam). Any
// signed-in user may read them — a price list is not venue data — but the
// session is still verified server-side. null = no billing configured (stub)
// or Stripe unreachable: the screen says the price is shown at checkout.

export type BillingPricesResult = { ok: true; prices: BillingPrices | null } | MutationError;

export async function getBillingPricesAction(): Promise<BillingPricesResult> {
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  try {
    return { ok: true, prices: await billing.listPrices() };
  } catch (err) {
    console.error('listPrices failed', { err: err instanceof Error ? err.message : 'unknown' });
    return { ok: true, prices: null };
  }
}
