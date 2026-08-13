// Coverage for 86ey2czr6 review round: submitGuestRequest's ordering — the
// honeypot must short-circuit BEFORE verifyTurnstileToken ever runs (a bot
// gets a fake success, no outbound siteverify fetch, no RPC), and a rejected
// Turnstile token must never reach the rate-limited submit_guest_request RPC.
import { describe, expect, it, vi, type Mock } from 'vitest';
import { submitGuestRequest } from './actions';
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

describe('submitGuestRequest — honeypot short-circuits before verification', () => {
  it('a filled honeypot returns a fake success without calling verifyTurnstileToken or the RPC', async () => {
    const rpc = vi.fn();
    (createClient as Mock).mockResolvedValue({ rpc });
    mockHost('plusone.example');

    const res = await submitGuestRequest({
      slug: 'frenzy',
      fullName: 'Bot Bot',
      plusOnes: 0,
      marketingOptIn: false,
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

    const res = await submitGuestRequest({
      slug: 'frenzy',
      fullName: 'Jip Jansen',
      plusOnes: 0,
      marketingOptIn: false,
      turnstileToken: 'bad-token',
    });

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

    const res = await submitGuestRequest({
      slug: 'frenzy',
      fullName: 'Jip Jansen',
      plusOnes: 0,
      marketingOptIn: false,
      turnstileToken: 'good-token',
    });

    expect(verifyTurnstileToken).toHaveBeenCalledWith('good-token', {
      remoteIp: '203.0.113.5',
      requestHost: 'plusone.example',
    });
    expect(rpc).toHaveBeenCalledWith('submit_guest_request', expect.objectContaining({ p_slug: 'frenzy' }));
    expect(res.ok).toBe(true);
  });
});
