'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth/context';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { billing } from './provider';
import type { PlanId } from './plans';
import {
  setVenuePlanSchema,
  completeOnboardingSchema,
  type SetVenuePlanInput,
  type CompleteOnboardingInput,
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
