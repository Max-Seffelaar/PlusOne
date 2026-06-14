'use server';

import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  submitGuestRequestSchema,
  approveGuestRequestSchema,
  denyGuestRequestSchema,
  type SubmitGuestRequestInput,
  type ApproveGuestRequestInput,
  type DenyGuestRequestInput,
} from './schemas';

export type ActionResult = { ok: true } | MutationError;

// Public aanvraagflow (#12/#28/#31). The submission is the only anon-writable
// path; its abuse protection (rate limit, honeypot, silent dedup, no event
// enumeration) lives partly here (honeypot, IP hashing) and partly in the
// submit_guest_request RPC (rate limit + dedup) — RLS stays the hard boundary.

/**
 * SHA-256 of the client IP with a server-side salt, so the throttle table never
 * stores a reversible IP (CLAUDE.md §security: no PII in logs/stores). Behind
 * Vercel `x-forwarded-for` is always set; the 'no-ip' fallback only bites in
 * local/dev and still degrades gracefully.
 */
async function clientIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') ?? '').trim();
  const salt = process.env.LANDING_IP_SALT ?? 'plusone-landing-dev-salt';
  return createHash('sha256').update(`${salt}:${ip || 'no-ip'}`).digest('hex');
}

/**
 * File a landing-page request (anon). Returns a generic result that never
 * reveals whether the guest/e-mail already exists (#28): a duplicate is
 * de-duplicated silently in the DB and still reports ok. A filled honeypot is
 * dropped while pretending success, so a bot learns nothing.
 */
export async function submitGuestRequest(input: SubmitGuestRequestInput): Promise<ActionResult> {
  const parsed = submitGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { slug, fullName, email, phone, plusOnes, motivation, company } = parsed.data;

  // Honeypot tripped → behave exactly like a success, but touch nothing.
  if (company && company.trim().length > 0) return { ok: true };

  const ipHash = await clientIpHash();
  const supabase = await createClient();

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
  });
  if (error) {
    console.error('[submitGuestRequest] rpc error:', error.message);
    return { ok: false, code: 'error', message: 'Er ging iets mis. Probeer het opnieuw.' };
  }

  switch (data) {
    case 'ok':
      return { ok: true };
    case 'rate_limited':
      return {
        ok: false,
        code: 'rate_limited',
        message: 'Te veel aanvragen vanaf dit netwerk. Probeer het over een paar minuten opnieuw.',
      };
    case 'closed':
      return {
        ok: false,
        code: 'closed',
        message: 'De aanmeldingen voor dit event zijn gesloten.',
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
