'use server';

// Platform-admin trial management (Billing G, decision #32(d) revised
// 2026-10-06): "Trial until <date>" and "Always free" per company, from the
// Platform tab. Replaces the service-role SQL runbook (docs/stripe-setup.md §5).
//
// Security shape (CLAUDE.md #1 — RLS/DB is the boundary):
//  - Both actions call SECURITY DEFINER RPCs (20261008120200) through the
//    USER-SCOPED client. The RPC re-checks is_platform_admin() itself and
//    raises 42501 for anyone else — a venue admin, finance or manager of that
//    very company included. No service-role client here.
//  - The audit row is written by the audit_subscriptions trigger under the
//    caller's auth.uid() (decision #4) — never by this code.
//  - Input: Zod; the client supplies only the venue id and a calendar day /
//    boolean. The date range check lives in the RPC too.
// Online-only writes from the Platform tab; nothing door-adjacent (#37).

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAuthContext } from '@/lib/auth/context';
import { t } from '@/lib/i18n';
import { invalidInput, mapMutationError, unauthorized, type MutationError } from '@/lib/db-errors';
import {
  platformBillingMailsPausedSchema,
  platformCompedSchema,
  platformTrialEndSchema,
  type PlatformBillingMailsPausedInput,
  type PlatformCompedInput,
  type PlatformTrialEndInput,
} from './schemas';
import { endOfDayInAmsterdam } from './dates';

export type PlatformBillingResult = { ok: true } | MutationError;

function platformBillingError(error: { code?: string; message?: string }): MutationError {
  switch (error.code) {
    case '55000':
      return { ok: false, code: '55000', message: t.platform.billingStripeManaged };
    case '22023':
      return { ok: false, code: '22023', message: t.platform.billingTrialOutOfRange };
    default:
      return mapMutationError(error);
  }
}

export async function setVenueTrialEndAction(input: PlatformTrialEndInput): Promise<PlatformBillingResult> {
  const parsed = platformTrialEndSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const endsAt = endOfDayInAmsterdam(parsed.data.trialEndsOn);
  if (!endsAt) return invalidInput(t.platform.billingTrialOutOfRange);

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_venue_trial_end', {
    p_venue_id: parsed.data.venueId,
    p_trial_ends_at: endsAt.toISOString(),
  });
  if (error) return platformBillingError(error);

  revalidatePath('/app');
  return { ok: true };
}

export async function setVenueCompedAction(input: PlatformCompedInput): Promise<PlatformBillingResult> {
  const parsed = platformCompedSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_venue_comped', {
    p_venue_id: parsed.data.venueId,
    p_comped: parsed.data.comped,
  });
  if (error) return platformBillingError(error);

  revalidatePath('/app');
  return { ok: true };
}

/**
 * Billing-mails B1 (z8uq9m2z19): pause or resume every billing mail to one
 * company. Same shape as the two above: user-scoped client, the RPC
 * (set_billing_mails_paused) re-checks is_platform_admin() and raises 42501
 * for anyone else; it stamps who paused on the settings row.
 */
export async function setBillingMailsPausedAction(
  input: PlatformBillingMailsPausedInput
): Promise<PlatformBillingResult> {
  const parsed = platformBillingMailsPausedSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const ctx = await getAuthContext();
  if (!ctx) return unauthorized();

  const supabase = await createClient();
  const { error } = await supabase.rpc('set_billing_mails_paused', {
    p_venue_id: parsed.data.venueId,
    p_paused: parsed.data.paused,
  });
  if (error) return mapMutationError(error);
  return { ok: true };
}
