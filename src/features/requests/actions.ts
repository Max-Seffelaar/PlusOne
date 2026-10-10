'use server';

import { createHash, randomBytes } from 'node:crypto';
import { headers } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { landingClientIpHash, landingClientIpForVerify } from './ip-hash';
import { publicRpcTrustHeaders } from './rpc-trust';
import { verifyTurnstileToken } from './turnstile';
import { mapMutationError, unauthorized, invalidInput, type MutationError } from '@/lib/db-errors';
import {
  submitGuestRequestSchema,
  approveGuestRequestSchema,
  decideGuestRequestSchema,
  decideGuestRequestResultSchema,
  submitGuestRequestResultSchema,
  type SubmitGuestRequestInput,
  type ApproveGuestRequestInput,
  type DecideGuestRequestInput,
  type DecideGuestRequestResult,
} from './schemas';
import { drainQueuedGuestMails, queueGuestMails, queueRequestDeclinedMail } from '@/features/mail/guest-queue';

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
  const {
    slug,
    fullName,
    email,
    phone,
    plusOnes,
    motivation,
    birthdate,
    marketingOptIn,
    company,
    turnstileToken,
  } = parsed.data;

  // Honeypot tripped → behave exactly like a success, but touch nothing (no
  // status token either — a bot has no use for one).
  if (company && company.trim().length > 0) return { ok: true };

  // Turnstile verifies BEFORE the rate-limited RPC, which inverts the
  // 20260625100000 invariant "rate limit FIRST — every attempt burns quota"
  // (consume_public_throttle is consume-on-check *inside* the RPC, so there
  // is no cheap way to check the throttle without also consuming it first).
  // Accepted exposure: a junk-token flood costs one outbound siteverify fetch
  // per attempt, bounded by VERIFY_TIMEOUT_MS — the Vercel Firewall rule on
  // /e/* (docs/landing-rate-limit-hardening.md §2) is the compensating edge
  // control for volume the DB throttle would otherwise absorb first.
  const requestHost = (await headers()).get('host') ?? undefined;
  const remoteIp = await landingClientIpForVerify();
  if (!(await verifyTurnstileToken(turnstileToken, { remoteIp, requestHost }))) {
    return {
      ok: false,
      code: 'verification_failed',
      message: "Couldn't verify you're human. Please try again.",
    };
  }

  const ipHash = await landingClientIpHash();
  // The trust header lets the DB honour ipHash as this server's claim (see rpc-trust.ts).
  const supabase = await createClient({ headers: publicRpcTrustHeaders() });

  // Bearer token for the /r/[token] status page. Generated here, shown once to
  // the requester; the DB stores only its sha256 (same stance as ip_hash).
  const statusToken = randomBytes(32).toString('base64url');
  const statusTokenHash = createHash('sha256').update(statusToken).digest('hex');

  // email/phone are required by the schema (86eyke279) and already trimmed +
  // shape-checked, so they go through as-is; the remaining optionals collapse
  // to '' — the RPC treats '' as "not provided" (and the generated arg types
  // are non-nullable strings). The RPC re-checks both fields itself: this
  // action is not the boundary, the SECURITY DEFINER function is.
  const { data, error } = await supabase.rpc('submit_guest_request', {
    p_slug: slug,
    p_full_name: fullName,
    p_email: email,
    p_phone: phone,
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

  // Unlike the rpc-error branch above, the request row (+ status_token_hash)
  // already exists in the DB by this point — a parse failure here means the
  // RPC's return shape drifted from what the app expects, not that the
  // requester did anything wrong. Blaming them with `invalidInput()` would
  // both discard their one-time /r/[token] status link and mislabel a
  // server-side bug as a client error, so this logs and reports the same
  // generic failure the rpc-error branch does.
  const parsedPayload = submitGuestRequestResultSchema.safeParse(data);
  if (!parsedPayload.success) {
    console.error(
      '[submitGuestRequest] unexpected rpc result shape:',
      parsedPayload.error.issues.map((i) => i.path.join('.')),
    );
    return { ok: false, code: 'error', message: 'Something went wrong. Try again.' };
  }
  const payload = parsedPayload.data;
  switch (payload.status) {
    case 'ok':
      // z8uq9m2vga: an auto-approve link queues the approval mail inside the
      // RPC (it never hands a guest id back to an anon caller, #28); this only
      // sends what is due now instead of waiting for the cron.
      if (payload.auto_approved === true) drainQueuedGuestMails();
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
 * tier-max / capacity / link-max). A full tier surfaces as 45002.
 *
 * z8uq9m0hw6: optionally for fewer plus-ones and with a message for the
 * requester's status page. Both are sent ONLY when set, so a plain approval
 * stays the 2-arg call the pre-migration function also resolves (the app may
 * deploy before the schema push). The RPC is the boundary for "never above the
 * request" and the message cap; this schema only rejects obvious garbage.
 */
export async function approveGuestRequest(input: ApproveGuestRequestInput): Promise<ActionResult> {
  const parsed = approveGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { requestId, tierId, plusOnes, message } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data: guestId, error } = await supabase.rpc('approve_guest_request', {
    p_request_id: requestId,
    p_tier_id: tierId,
    ...(plusOnes !== undefined ? { p_plus_ones: plusOnes } : {}),
    ...(message !== undefined ? { p_message: message } : {}),
  });
  if (error) return mapMutationError(error);

  // The decision mail (guest mail F) replaces "You're on the list" on this
  // path. A trimmed approval is the partly mail; the renderer reads the
  // asked-for count from the request and falls back to the plain approval
  // when nothing was actually trimmed. The enqueue RPC skips a request
  // without an address.
  if (typeof guestId === 'string') {
    queueGuestMails(
      [
        {
          type: plusOnes !== undefined ? 'guest_request_partly' : 'guest_request_approved',
          guestId,
          requestId,
          remark: message ?? null,
        },
      ],
      user.id,
    );
  }

  return { ok: true };
}

export type DecideOutcome = { ok: true; outcome: DecideGuestRequestResult['outcome'] } | MutationError;

/**
 * Requests E (z8uq9m2vga): decide a landing request in one go — trim it, split
 * it over tiers, decline (part of) it with a note — through the
 * `decide_guest_request` RPC, which re-checks the role, runs every cap per
 * created guest and rolls the whole decision back when one part does not fit.
 *
 * Then exactly one decision mail (guest mail F), only for a FIRST decision:
 * a replay of the same decision (double tap, retried action) queues nothing.
 *   approved / partly → on the first part (the guest row with the address);
 *   declined          → on the request (there is no guest).
 * The decision mail replaces "You're on the list" on this path.
 */
export async function decideGuestRequest(input: DecideGuestRequestInput): Promise<DecideOutcome> {
  const parsed = decideGuestRequestSchema.safeParse(input);
  if (!parsed.success) return invalidInput(parsed.error.issues[0]?.message);
  const { requestId, approved, declined, note } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return unauthorized();

  const { data, error } = await supabase.rpc('decide_guest_request', {
    p_request_id: requestId,
    p_decision: {
      approved: approved.map((part) => ({ tier_id: part.tierId, plus_ones: part.plusOnes })),
      declined,
      note: note ?? null,
    },
  });
  if (error) return mapMutationError(error);

  const result = decideGuestRequestResultSchema.safeParse(data);
  if (!result.success) {
    // The decision is saved; only the answer drifted. Say so without a mail.
    console.error('[decideGuestRequest] unexpected rpc result shape');
    return { ok: false, code: 'error', message: 'Something went wrong. Try again.' };
  }
  const { outcome, guest_ids: guestIds, replay } = result.data;

  if (!replay) {
    if (outcome === 'declined') {
      if (note) queueRequestDeclinedMail(requestId, note, user.id);
    } else if (guestIds[0]) {
      queueGuestMails(
        [
          {
            type: outcome === 'partly' ? 'guest_request_partly' : 'guest_request_approved',
            guestId: guestIds[0],
            requestId,
            remark: note ?? null,
          },
        ],
        user.id,
      );
    }
  }

  return { ok: true, outcome };
}
