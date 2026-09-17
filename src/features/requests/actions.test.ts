// Coverage for 86ey2czr6 review round: submitGuestRequest's ordering — the
// honeypot must short-circuit BEFORE verifyTurnstileToken ever runs (a bot
// gets a fake success, no outbound siteverify fetch, no RPC), and a rejected
// Turnstile token must never reach the rate-limited submit_guest_request RPC.
//
// Plus 86eyke279: e-mail + phone are required, so every fixture here carries
// both — and a submission missing either must die in the schema, before the
// RPC is ever reached.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { submitGuestRequest } from './actions';
import type { SubmitGuestRequestInput } from './schemas';
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
