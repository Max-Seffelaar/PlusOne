'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { landingClientIpHash } from './ip-hash';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  submitGuestRequestSchema,
  approveGuestRequestSchema,
  denyGuestRequestSchema,
  submitGuestRequestResultSchema,
  type SubmitGuestRequestInput,
  type ApproveGuestRequestInput,
  type DenyGuestRequestInput,
} from './schemas';

export type ActionResult = { ok: true } | MutationError;

/**
 * Submission outcome: the requester gets a bearer status URL (/r/[token]) and,
 * on an auto-approve link, the "you're on the list" confirmation. Only the
 * sha256 of the token ever reaches the database.
 */
export type SubmitOutcome =
  | { ok: true; statusToken?: string; autoApproved?: boolean }
  | MutationError;

// Public aanvraagflow (#12/#28/#31). The submission is the only anon-writable
// path; its abuse protection (rate limit, honeypot, silent dedup, no event
// enumeration) lives partly here (honeypot, IP hashing) and partly in the
// submit_guest_request RPC (rate limit + dedup) — RLS stays the hard boundary.

/**
 * File a landing-page request (anon). Returns a generic result that never
 * reveals whether the guest/e-mail already exists (#28): a duplicate is
 * de-duplicated silently in the DB and still reports ok. A filled honeypot is
 * dropped while pretending success, so a bot learns nothing.
 */
export async function submitGuestRequest(input: SubmitGuestRequestInput): Promise<SubmitOutcome> {
  const parsed = submitGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { slug, fullName, email, phone, plusOnes, motivation, birthdate, marketingOptIn, company } =
    parsed.data;

  // Honeypot tripped → behave exactly like a success, but touch nothing (no
  // status token either — a bot has no use for one).
  if (company && company.trim().length > 0) return { ok: true };

  const ipHash = await landingClientIpHash();
  const supabase = await createClient();

  // Bearer token for the /r/[token] status page. Generated here, shown once to
  // the requester; the DB stores only its sha256 (same stance as ip_hash).
  const statusToken = randomBytes(32).toString('base64url');
  const statusTokenHash = createHash('sha256').update(statusToken).digest('hex');

  // Optionals collapse to '' — the RPC treats '' as "not provided" (and the
  // generated arg types are non-nullable strings).
  const { data, error } = await supabase.rpc('submit_guest_request', {
    p_slug: slug,
    p_full_name: fullName,
    p_email: email ?? '',
    p_phone: phone ?? '',
    p_plus_ones: plusOnes,
    p_motivation: motivation ?? '',
    p_ip_hash: ipHash,
    p_marketing_opt_in: marketingOptIn,
    p_status_token_hash: statusTokenHash,
    ...(birthdate ? { p_birthdate: birthdate } : {}),
  });
  if (error) {
    console.error('[submitGuestRequest] rpc error:', error.message);
    return { ok: false, code: 'error', message: 'Something went wrong. Try again.' };
  }

  const parsedPayload = submitGuestRequestResultSchema.safeParse(data ?? {});
  if (!parsedPayload.success) return invalidInput();
  const payload = parsedPayload.data;
  switch (payload.status) {
    case 'ok':
      return { ok: true, statusToken, autoApproved: payload.auto_approved === true };
    case 'rate_limited':
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Too many requests from this network. Try again in a few minutes.',
      };
    case 'closed':
      return {
        ok: false,
        code: 'closed',
        message: 'Requests for this event are closed.',
      };
    default:
      return invalidInput();
  }
}

/**
 * Approve a request → create the guest (source=landing, #31) and mark the
 * request approved, atomically via the RPC (re-checks admin/organizer, applies
 * tier-max). A full tier surfaces as 45002.
 */
export async function approveGuestRequest(input: ApproveGuestRequestInput): Promise<ActionResult> {
  const parsed = approveGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { requestId, tierId, eventId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { error } = await supabase.rpc('approve_guest_request', {
    p_request_id: requestId,
    p_tier_id: tierId,
  });
  if (error) return mapMutationError(error);

  if (eventId) {
    revalidatePath(`/events/${eventId}/requests`);
    revalidatePath(`/events/${eventId}/guests`);
  }
  return { ok: true };
}

/** Deny a request with a mandatory reason. A plain RLS-gated update (#12). */
export async function denyGuestRequest(input: DenyGuestRequestInput): Promise<ActionResult> {
  const parsed = denyGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { requestId, reason, eventId } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  // RLS (guest_requests_decide) pins status='pending', the actor, and the
  // admin/organizer role; a stale/decided request simply matches no row.
  const { error } = await supabase
    .from('guest_requests')
    .update({
      status: 'denied',
      decided_by: user.id,
      decided_at: new Date().toISOString(),
      decision_reason: reason,
    })
    .eq('id', requestId)
    .eq('status', 'pending');
  if (error) return mapMutationError(error);

  if (eventId) revalidatePath(`/events/${eventId}/requests`);
  return { ok: true };
}
