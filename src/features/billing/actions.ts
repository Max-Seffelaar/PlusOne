'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getAuthContext } from '@/lib/auth/context';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { billing } from './provider';
import { DEFAULT_PLAN_ID, isPlanId, trialEndsAt, type PlanId } from './plans';
import {
  setVenuePlanSchema,
  completeOnboardingSchema,
  billingSessionSchema,
  type SetVenuePlanInput,
  type CompleteOnboardingInput,
  type BillingSessionInput,
} from './schemas';

// Onboarding-time billing writes. subscriptions has no authenticated INSERT/UPDATE
// path (Stripe/webhook writes only, #32), so both actions go through the
// SECURITY DEFINER RPCs from 20260615000000 which re-check admin authority in the
// database. The status decision lives behind the BillingProvider, never inline.

export type BillingActionResult = { ok: true } | MutationError;

/**
 * Set/replace the plan on a venue during onboarding (resumable Plan step).
 * The venue's creator is already its admin, so the RPC's admin check passes
 * without MFA (a fresh owner has not enrolled yet).
 */
export async function setVenuePlanAction(input: SetVenuePlanInput): Promise<BillingActionResult> {
  const parsed = setVenuePlanSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId, planId } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const { status } = await billing.startSubscription({ venueId, planId: planId as PlanId });

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_venue_plan', {
    p_venue_id: venueId,
    p_plan_id: planId,
    p_comped: status === 'comped',
  });
  if (error) return mapMutationError(error);

  revalidatePath('/onboarding');
  revalidatePath('/app');
  return { ok: true };
}

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

/** The caller's roles at the venue, via the user-scoped client (a user always
 *  reads their own membership; a non-member reads nothing). */
async function callerIsVenueAdmin(venueId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data: userRes } = await supabase.auth.getUser();
  if (!userRes.user) return false;
  const { data } = await supabase
    .from('venue_memberships')
    .select('roles')
    .eq('venue_id', venueId)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  return (data?.roles ?? []).includes('admin');
}

/**
 * Start Stripe Checkout for the venue's subscription. Admin-only; the plan is
 * resolved server-side from the venue's own subscription row (a venue that
 * never picked a plan checks out on the default paid plan). Remaining app-side
 * trial carries into Stripe as trial_end. The fresh customer id is persisted
 * immediately (stamp_stripe_customer, service-role — second documented confined
 * usage besides the webhook) so a webhook can always match by customer.
 */
export async function createCheckoutSessionAction(
  input: BillingSessionInput
): Promise<BillingUrlResult> {
  const parsed = billingSessionSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { venueId } = parsed.data;

  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();
  if (!(await callerIsVenueAdmin(venueId))) return unauthorized();

  const supabase = await createClient();
  const [{ data: venue }, { data: sub }] = await Promise.all([
    supabase
      .from('venues')
      .select('name, company_name, vat_number, finance_email')
      .eq('id', venueId)
      .maybeSingle(),
    supabase
      .from('subscriptions')
      .select('status, plan_id, created_at, stripe_customer_id, stripe_subscription_id')
      .eq('venue_id', venueId)
      .maybeSingle(),
  ]);
  if (!venue || !sub) return invalidInput('No subscription found for this venue.');

  if (sub.status === 'comped') {
    return billingErr('comped', 'This venue runs on a pilot agreement — billing is handled by us.');
  }
  if (sub.stripe_subscription_id && sub.status !== 'canceled') {
    return billingErr(
      'already_subscribed',
      'There already is an active subscription. Manage it via the billing portal.'
    );
  }

  const planId: PlanId =
    sub.plan_id && isPlanId(sub.plan_id) && sub.plan_id !== 'indie'
      ? sub.plan_id
      : DEFAULT_PLAN_ID;

  const origin = await appOrigin();
  const result = await billing.createCheckoutSession({
    venueId,
    planId,
    company: {
      name: venue.company_name ?? venue.name,
      vatNumber: venue.vat_number ?? null,
      financeEmail: venue.finance_email ?? null,
    },
    customerEmail: ctx.user.email ?? '',
    existingCustomerId: sub.stripe_customer_id ?? null,
    trialEnd: sub.status === 'trialing' ? trialEndsAt(sub.created_at) : null,
    successUrl: `${origin}/app?billing=success`,
    cancelUrl: `${origin}/app?billing=canceled`,
  });

  if (!result.ok) {
    return result.reason === 'free_plan'
      ? billingErr('free_plan', 'This plan has no paid subscription.')
      : billingErr('unavailable', "Billing isn't live yet. Try again later.");
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
 * Open the Stripe customer portal (payment method + invoices). Admin-only;
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
  if (!(await callerIsVenueAdmin(venueId))) return unauthorized();

  const supabase = await createClient();
  const { data: sub } = await supabase
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!sub?.stripe_customer_id) {
    return billingErr('no_customer', 'Set up your payment first — the portal opens after that.');
  }

  const origin = await appOrigin();
  const result = await billing.createPortalSession({
    customerId: sub.stripe_customer_id,
    returnUrl: `${origin}/app?billing=portal-return`,
  });
  if (!result.ok) return billingErr('unavailable', "Billing isn't live yet. Try again later.");
  return { ok: true, url: result.url };
}
