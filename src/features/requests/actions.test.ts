import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { submitGuestRequest } from './actions';
import { createClient } from '@/lib/supabase/server';

// submitGuestRequest calls createClient() (Supabase) and landingClientIpHash()
// (next/headers under the hood) — both unavailable outside a request context.
// Mock both so each test hands back a minimal fake.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

const BASE_INPUT = {
  slug: 'frenzy',
  fullName: 'Jip Jansen',
  plusOnes: 0,
};

function mockRpcClient(rpc: Mock) {
  (createClient as Mock).mockResolvedValue({ rpc });
}

describe('submitGuestRequest — Turnstile gate (86ey2czr6)', () => {
  let fetchSpy: Mock;

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('keyless-safe: without TURNSTILE_SECRET_KEY the check is skipped and the RPC still runs', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const rpc = vi.fn(async () => ({ data: { status: 'ok' }, error: null }));
    mockRpcClient(rpc);

    const res = await submitGuestRequest(BASE_INPUT);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('fails closed with no token once TURNSTILE_SECRET_KEY is configured — RPC never runs', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    const rpc = vi.fn(async () => ({ data: { status: 'ok' }, error: null }));
    mockRpcClient(rpc);

    const res = await submitGuestRequest(BASE_INPUT);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, code: 'error', message: 'Something went wrong. Try again.' });
  });

  it('accepts a token Cloudflare confirms as successful, then runs the RPC', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    const rpc = vi.fn(async () => ({ data: { status: 'ok' }, error: null }));
    mockRpcClient(rpc);

    const res = await submitGuestRequest({ ...BASE_INPUT, turnstileToken: 'good-token' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(res.ok).toBe(true);
  });

  it('rejects a token Cloudflare marks unsuccessful, with the same generic message (no enumeration)', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    fetchSpy.mockResolvedValue({ ok: true, json: async () => ({ success: false }) });
    const rpc = vi.fn(async () => ({ data: { status: 'ok' }, error: null }));
    mockRpcClient(rpc);

    const res = await submitGuestRequest({ ...BASE_INPUT, turnstileToken: 'bad-token' });

    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, code: 'error', message: 'Something went wrong. Try again.' });
  });

  it('fails closed when the Cloudflare siteverify call itself errors', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    fetchSpy.mockRejectedValue(new Error('network down'));
    const rpc = vi.fn(async () => ({ data: { status: 'ok' }, error: null }));
    mockRpcClient(rpc);

    const res = await submitGuestRequest({ ...BASE_INPUT, turnstileToken: 'whatever' });

    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: false, code: 'error', message: 'Something went wrong. Try again.' });
  });

  it('honeypot still short-circuits before Turnstile is ever checked', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    const rpc = vi.fn();
    mockRpcClient(rpc);

    const res = await submitGuestRequest({ ...BASE_INPUT, company: 'bot filled this' });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(res).toEqual({ ok: true });
  });
});
