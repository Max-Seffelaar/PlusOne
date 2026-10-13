'use server';

import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/database.types';
import { mapMutationError, unauthorized, invalidInput, notFound, type MutationError } from '@/lib/db-errors';
import { t } from '@/lib/i18n';
import {
  quotaRequestSchema,
  decideQuotaRequestSchema,
  markQuotaRequestSeenSchema,
  type QuotaRequestInput,
  type DecideQuotaRequestInput,
  type MarkQuotaRequestSeenInput,
} from './schemas';
import { drainTeamMailsSoon } from '@/features/mail/team-queue';

/** SQLSTATE the quota engine raises for a request that is no longer pending. */
const REQUEST_DECIDED = '45003';

/** A deny that matched no row: already decided, or not the caller's to decide.
 *  One message for both — it never says which, so it reveals nothing the caller
 *  couldn't already read. */
const NOT_DECIDABLE: MutationError = {
  ok: false,
  code: REQUEST_DECIDED,
  message: t.quotaRequests.notDecidable,
};

/** An approve that lost the race (or hit an already-decided row). The RPC's
 *  45003 message is Dutch DB text; map it by code to English catalogue copy. */
const ALREADY_HANDLED: MutationError = {
  ok: false,
  code: REQUEST_DECIDED,
  message: t.quotaRequests.alreadyHandled,
};

export type ActionResult = { ok: true } | MutationError;

/**
 * An approval that names a guest (z8uq9m2xyp) rolls back as a whole when the
 * guest cannot be added. The quota engine's own messages are Dutch DB text and
 * speak to the person adding, not to the admin approving; map them by code to
 * catalogue copy that says nothing changed and what to do instead.
 */
const APPROVE_GUEST_FAILED: Record<string, string> = {
  '45001': t.quotaRequests.guestNoFit,
  '45002': t.quotaRequests.guestTierFull,
  '45005': t.quotaRequests.guestCapacity,
  '45007': t.quotaRequests.guestListLocked,
  '45008': t.quotaRequests.guestTierGone,
};

// Quota-request flow (#4/#5). Staff file; admins decide. Privilege is role-only
// (no AAL2 anywhere since 20260624160000): the filing and the deny are enforced
// by RLS, and the column UPDATE grant (20260925140000) limits a client write to
// status/decided_by/decided_at/decision_reason with status = 'denied' only.
// Approval flows exclusively through the approve_quota_request RPC so the
// override write + status flip are atomic and re-checked server-side (row-locked
// since 20260925140100). Everything lands in the audit log via triggers.

/** Staff requests X extra slots with a motivation (#5), optionally naming the
 *  guest they are for (z8uq9m2xyp: added on approval, on the requester's name).
 *  The tier must be one of this event's — the DB guard re-checks it (23514). */
export async function requestExtraSlots(input: QuotaRequestInput): Promise<ActionResult> {
  const parsed = quotaRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { eventId, requestedExtra, motivation, guest } = parsed.data;

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
    ...(guest
      ? {
          // Snake-case keys = the shape quota_guest_payload_is_valid checks.
          guest_payload: {
            name: guest.name,
            plus_ones: guest.plusOnes,
            tier_id: guest.tierId,
            ...(guest.phone ? { phone: guest.phone } : {}),
            ...(guest.note ? { note: guest.note } : {}),
          },
        }
      : {}),
  } as Database['public']['Tables']['quota_requests']['Insert']);
  if (error) {
    if (guest && error.code === '23514') return invalidInput(t.quotaRequests.guestInvalid);
    return mapMutationError(error);
  }

  drainTeamMailsSoon(); // 6b: the admins' / requester's mail, after the response
  return { ok: true };
}

/**
 * Admin decides a request. Approve -> approve_quota_request RPC (atomic override
 * grant; admin role checked in the DB). Deny -> a direct, RLS-gated update of
 * exactly the four granted columns. RLS turns a row the caller may not decide
 * (already decided, other venue, not an admin) into UPDATE 0, not an error, so
 * the deny asks for the updated id back and treats zero rows as a refusal.
 */
export async function decideQuotaRequest(input: DecideQuotaRequestInput): Promise<ActionResult> {
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
    if (error?.code === REQUEST_DECIDED) return ALREADY_HANDLED;
    const guestFailed = error?.code ? APPROVE_GUEST_FAILED[error.code] : undefined;
    if (error && guestFailed) return { ok: false, code: error.code ?? 'unknown', message: guestFailed };
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

  drainTeamMailsSoon(); // 6b: the admins' / requester's mail, after the response
  return { ok: true };
}

/**
 * The requester dismisses a decided request on Home ("Got it" / "Add guests",
 * z8uq9m2xyp). A plain RLS-gated update of the one granted column: policy
 * quota_requests_seen_own (own, decided rows) + the column grant; the DB stamps
 * the time itself. Zero rows = not theirs, still pending, or already gone.
 */
export async function markQuotaRequestSeen(input: MarkQuotaRequestSeenInput): Promise<ActionResult> {
  const parsed = markQuotaRequestSeenSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase
    .from('quota_requests')
    .update({ seen_at: new Date().toISOString() })
    .eq('id', parsed.data.requestId)
    .eq('user_id', user.id)
    .select('id');
  if (error) return mapMutationError(error);
  if (!data || data.length === 0) return notFound();
  return { ok: true };
}
