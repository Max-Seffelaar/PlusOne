import 'server-only';

// Soft-block gate (fase 13 PR 3, #32 refinement): a canceled venue or a lapsed
// unpaid trial can no longer GROW — no new events, no invites, no bulk import —
// but everything already planned keeps running: guest lists, the door (outbox
// writes are deliberately never gated), stats, data access. This is COMMERCIAL
// gating on top of RLS, not a security boundary — membership/RLS still bounds
// every read and write. The checkout action is exempt (it's the way back in).

import { createClient } from '@/lib/supabase/server';
import type { MutationError } from '@/lib/db-errors';
import { billingBlockReason } from './plans';

const BLOCK_MESSAGES: Record<'canceled' | 'trial_expired', string> = {
  canceled: 'The subscription is canceled — reactivate billing to make changes.',
  trial_expired: 'Your trial has ended — set up your payment to make changes.',
};

/**
 * Returns a MutationError when the venue's billing state blocks growth
 * actions, null when the action may proceed. Reads through the user-scoped
 * client (RLS: members read their venue's subscription); a missing row —
 * non-member or pre-onboarding — resolves to null and leaves RLS/role checks
 * to the action itself, as before.
 */
export async function assertVenueBillingActive(venueId: string): Promise<MutationError | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('subscriptions')
    .select('status, created_at, stripe_subscription_id')
    .eq('venue_id', venueId)
    .maybeSingle();
  if (!data) return null;

  const reason = billingBlockReason({
    status: data.status,
    createdAt: data.created_at,
    stripeSubscriptionId: data.stripe_subscription_id,
  });
  if (!reason) return null;
  return { ok: false, code: `billing_${reason}`, message: BLOCK_MESSAGES[reason] };
}
