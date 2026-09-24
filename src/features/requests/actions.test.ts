// Coverage for 86ey2czr6 review round: submitGuestRequest's ordering — the
// honeypot must short-circuit BEFORE verifyTurnstileToken ever runs (a bot
// gets a fake success, no outbound siteverify fetch, no RPC), and a rejected
// Turnstile token must never reach the rate-limited submit_guest_request RPC.
//
// Plus 86eyke279: e-mail + phone are required, so every fixture here carries
// both — and a submission missing either must die in the schema, before the
// RPC is ever reached.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { approveGuestRequest, submitGuestRequest } from './actions';
import type { ApproveGuestRequestInput, SubmitGuestRequestInput } from './schemas';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import { verifyTurnstileToken } from './turnstile';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('./turnstile', () => ({
  verifyTurnstileToken: vi.fn(),
}));

vi.mock('./ip-hash', () => ({
  landingClientIpHash: vi.fn(async () => 'hashed-ip'),
  landingClientIpForVerify: vi.fn(async () => '203.0.113.5'),
}));

function mockHost(host: string | null): void {
  (headers as Mock).mockResolvedValue({ get: (name: string) => (name === 'host' ? host : null) });
}

/** The minimum a public request needs since 86eyke279 (name + e-mail + phone). */
const BASE = {
  slug: 'frenzy',
  fullName: 'Jip Jansen',
  email: 'jip@voorbeeld.nl',
  phone: '+31612345678',
  plusOnes: 0,
  marketingOptIn: false,
} as const;

describe('submitGuestRequest — honeypot short-circuits before verification', () => {
  it('a filled honeypot returns a fake success without calling verifyTurnstileToken or the RPC', async () => {
    const rpc = vi.fn();
    (createClient as Mock).mockResolvedValue({ rpc });
    mockHost('plusone.example');

    const res = await submitGuestRequest({
      ...BASE,
      fullName: 'Bot Bot',
      company: 'I am a bot',
    });

    expect(res).toEqual({ ok: true });
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('submitGuestRequest — Turnstile verification gate', () => {
  it('returns verification_failed and never calls the RPC when Turnstile rejects', async () => {
    const rpc = vi.fn();
    (createClient as Mock).mockResolvedValue({ rpc });
    mockHost('plusone.example');
    (verifyTurnstileToken as Mock).mockResolvedValue(false);

    const res = await submitGuestRequest({ ...BASE, turnstileToken: 'bad-token' });

    expect(res).toEqual({
      ok: false,
      code: 'verification_failed',
      message: "Couldn't verify you're human. Please try again.",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes the request host and raw client IP through to verifyTurnstileToken, and proceeds to the RPC on success', async () => {
    const rpc = vi.fn(async () => ({ data: { status: 'ok', auto_approved: false }, error: null }));
    (createClient as Mock).mockResolvedValue({ rpc });
    mockHost('plusone.example');
    (verifyTurnstileToken as Mock).mockResolvedValue(true);

    const res = await submitGuestRequest({ ...BASE, turnstileToken: 'good-token' });

    expect(verifyTurnstileToken).toHaveBeenCalledWith('good-token', {
      remoteIp: '203.0.113.5',
      requestHost: 'plusone.example',
    });
    expect(rpc).toHaveBeenCalledWith(
      'submit_guest_request',
      expect.objectContaining({
        p_slug: 'frenzy',
        // Passed straight through, no `?? ''` fallback — the schema guarantees
        // both are present and trimmed (86eyke279).
        p_email: 'jip@voorbeeld.nl',
        p_phone: '+31612345678',
      })
    );
    expect(res.ok).toBe(true);
  });
});

// 86eyke279 — the app-path half of "e-mail and phone are required". The RPC
// enforces the same rule independently (migration 20260819110000) for callers
// that skip this action entirely.
describe('submitGuestRequest — contact details are required', () => {
  it.each([
    ['no e-mail', { email: undefined }],
    ['empty e-mail', { email: '' }],
    ['whitespace-only e-mail', { email: '   ' }],
    ['no phone', { phone: undefined }],
    ['empty phone', { phone: '' }],
    ['whitespace-only phone', { phone: '  ' }],
  ])('rejects a submission with %s without ever reaching the RPC', async (_label, patch) => {
    const rpc = vi.fn();
    (createClient as Mock).mockResolvedValue({ rpc });
    mockHost('plusone.example');
    (verifyTurnstileToken as Mock).mockResolvedValue(true);

    // The cast is the point of the test, not a workaround: since 86eyke279 the
    // input type FORBIDS these shapes, so TypeScript already stops the app's
    // own call sites. What is being exercised here is the runtime guard that
    // still has to hold for a caller with no types at all — a hand-rolled
    // fetch, a replayed request, plain JS.
    const res = await submitGuestRequest({ ...BASE, ...patch } as unknown as SubmitGuestRequestInput);

    expect(res.ok).toBe(false);
    expect(res.ok === false && res.code).toBe('invalid');
    expect(rpc).not.toHaveBeenCalled();
  });
});

// z8uq9m0hw6 — partial approval + venue message. The action is not the
// boundary (the SECURITY DEFINER RPC re-checks the role, the per-request
// bound and the cap); what it owns is the CALL SHAPE: a plain approval must
// stay the 2-arg call the pre-migration function also resolves, so a deploy
// that lands before the schema push keeps approving.
describe('approveGuestRequest — partial approval + message', () => {
  const REQ_ID = '00000000-0000-7000-8000-00000000000a';
  const TIER_ID = '00000000-0000-7000-8000-00000000000b';

  function mockApprover(result: { error: { code: string; message: string } | null } = { error: null }) {
    const rpc = vi.fn().mockResolvedValue({ data: 'guest-id', ...result });
    const getUser = vi.fn().mockResolvedValue({ data: { user: { id: 'approver' } } });
    (createClient as Mock).mockResolvedValue({ rpc, auth: { getUser } });
    return rpc;
  }

  it('a plain approval sends exactly the two original args', async () => {
    const rpc = mockApprover();
    const res = await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('approve_guest_request', { p_request_id: REQ_ID, p_tier_id: TIER_ID });
  });

  it('forwards the approved count and the trimmed message', async () => {
    const rpc = mockApprover();
    await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, plusOnes: 2, message: '  See you at 23:00.  ' });
    expect(rpc).toHaveBeenCalledWith('approve_guest_request', {
      p_request_id: REQ_ID,
      p_tier_id: TIER_ID,
      p_plus_ones: 2,
      p_message: 'See you at 23:00.',
    });
  });

  it('forwards an approval for zero plus-ones (0 is a count, not "unset")', async () => {
    const rpc = mockApprover();
    await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, plusOnes: 0 });
    expect(rpc).toHaveBeenCalledWith('approve_guest_request', { p_request_id: REQ_ID, p_tier_id: TIER_ID, p_plus_ones: 0 });
  });

  it('drops a whitespace-only message instead of sending it', async () => {
    const rpc = mockApprover();
    await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, message: ' \n\t ' });
    expect(rpc).toHaveBeenCalledWith('approve_guest_request', { p_request_id: REQ_ID, p_tier_id: TIER_ID });
  });

  it.each([
    ['a negative count', { plusOnes: -1 }],
    ['a fractional count', { plusOnes: 1.5 }],
    ['a count above the submit cap', { plusOnes: 21 }],
    ['a 281-character message', { message: 'x'.repeat(281) }],
  ])('rejects %s before the RPC', async (_label, patch) => {
    const rpc = mockApprover();
    const res = await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, ...patch } as ApproveGuestRequestInput);
    expect(res.ok === false && res.code).toBe('invalid');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts a message of exactly 280 characters', async () => {
    const rpc = mockApprover();
    const res = await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, message: 'y'.repeat(280) });
    expect(res.ok).toBe(true);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it('maps the RPC refusal of a count above the request (23514) to generic copy', async () => {
    mockApprover({ error: { code: '23514', message: 'Approve between 0 plus-ones and the number requested.' } });
    const res = await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, plusOnes: 5 });
    expect(res).toEqual({ ok: false, code: '23514', message: 'Some details are missing or invalid.' });
  });

  it('refuses without a session and never reaches the RPC', async () => {
    const rpc = vi.fn();
    const getUser = vi.fn().mockResolvedValue({ data: { user: null } });
    (createClient as Mock).mockResolvedValue({ rpc, auth: { getUser } });
    const res = await approveGuestRequest({ requestId: REQ_ID, tierId: TIER_ID, plusOnes: 1 });
    expect(res.ok === false && res.code).toBe('unauthorized');
    expect(rpc).not.toHaveBeenCalled();
  });
});
