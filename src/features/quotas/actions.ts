'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';

/** A deny that matched no row: already decided, or not the caller's to decide.
 *  One message for both — it never says which, so it reveals nothing the caller
 *  couldn't already read. */
const NOT_DECIDABLE: MutationError = {
  ok: false,
  code: '45003',
  message: 'This request has already been handled or cannot be decided by you.',
};
import { quotaRequestSchema, decideQuotaRequestSchema, type QuotaRequestInput, type DecideQuotaRequestInput } from './schemas';

export type ActionResult = { ok: true } | MutationError;

// Quota-request flow (#4/#5). Staff file; admins decide. Privilege is role-only
// (no AAL2 anywhere since 20260624160000): the filing and the deny are enforced
// by RLS, and the column UPDATE grant (20260925140000) limits a client write to
// status/decided_by/decided_at/decision_reason with status = 'denied' only.
// Approval flows exclusively through the approve_quota_request RPC so the
// override write + status flip are atomic and re-checked server-side (row-locked
// since 20260925140100). Everything lands in the audit log via triggers.

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

  // venue_id is populated by the set_event_scope BEFORE INSERT trigger
  // (migration 20260708120000); cast over the omitted column.
  const { error } = await supabase.from('quota_requests').insert({
    event_id: eventId,
    user_id: user.id, // RLS pins this to the actor
    requested_extra: requestedExtra,
    motivation,
  } as Database['public']['Tables']['quota_requests']['Insert']);
  if (error) return mapMutationError(error);

  revalidatePath(`/events/${eventId}/guests`);
  revalidatePath(`/events/${eventId}/quota-requests`);
  return { ok: true };
}

/**
 * Admin decides a request. Approve -> approve_quota_request RPC (atomic override
 * grant; admin role checked in the DB). Deny -> a direct, RLS-gated update of
 * exactly the four granted columns. RLS turns a row the caller may not decide
 * (already decided, other venue, not an admin) into UPDATE 0, not an error, so
 * the deny asks for the updated id back and treats zero rows as a refusal.
 * eventId is only used to revalidate the right paths.
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
    const { data, error } = await supabase
      .from('quota_requests')
      .update({
        status: 'denied',
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        decision_reason: reason ?? null,
      })
      .eq('id', requestId)
      .select('id');
    if (error) return mapMutationError(error);
    if (!data || data.length === 0) return NOT_DECIDABLE;
  }

  if (input.eventId) {
    revalidatePath(`/events/${input.eventId}/guests`);
    revalidatePath(`/events/${input.eventId}/quota-requests`);
  }
  return { ok: true };
}
