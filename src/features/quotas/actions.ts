'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import { quotaRequestSchema, decideQuotaRequestSchema, type QuotaRequestInput, type DecideQuotaRequestInput } from './schemas';

export type ActionResult = { ok: true } | MutationError;

// Quota-request flow (#4/#5). Staff file; admins decide with AAL2. Both the
// filing and the decision are enforced by RLS; approval also flows through the
// approve_quota_request RPC so the override write + status flip are atomic and
// re-checked server-side. Everything lands in the audit log via triggers.

/** Staff requests X extra slots with a motivation (#5). */
export async function requestExtraSlots(input: QuotaRequestInput): Promise<ActionResult> {
  const parsed = quotaRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, requestedExtra, motivation } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.from('quota_requests').insert({
    event_id: eventId,
    user_id: user.id, // RLS pins this to the actor
    requested_extra: requestedExtra,
    motivation,
  });
  if (error) return mapMutationError(error);

  revalidatePath(`/events/${eventId}/guests`);
  revalidatePath(`/events/${eventId}/quota-requests`);
  return { ok: true };
}

/**
 * Admin decides a request. Approve -> approve_quota_request RPC (atomic override
 * grant, AAL2-checked in the DB). Deny -> a direct, RLS-gated update with the
 * reason. eventId is only used to revalidate the right paths.
 */
export async function decideQuotaRequest(
  input: DecideQuotaRequestInput & { eventId?: string }
): Promise<ActionResult> {
  const parsed = decideQuotaRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { requestId, decision, reason } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  if (decision === 'approved') {
    const { error } = await supabase.rpc('approve_quota_request', { p_request_id: requestId });
    if (error) return mapMutationError(error);
  } else {
    const { error } = await supabase
      .from('quota_requests')
      .update({
        status: 'denied',
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_reason: reason ?? null,
      })
      .eq('id', requestId);
    if (error) return mapMutationError(error);
  }

  if (input.eventId) {
    revalidatePath(`/events/${input.eventId}/guests`);
    revalidatePath(`/events/${input.eventId}/quota-requests`);
  }
  return { ok: true };
}
