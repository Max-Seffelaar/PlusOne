// Coverage for 86ey2czr6: verifyTurnstileToken's keyless dev/CI stance
// (mirrors the billing stub provider — no secret configured, no rejection)
// and its fail-OPEN posture on a broken/unreachable siteverify call.
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadVerify() {
  vi.resetModules();
  return import('./turnstile');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyTurnstileToken', () => {
  it('passes open with no token when TURNSTILE_SECRET_KEY is unset (keyless)', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(true);
  });

  it('rejects a missing token once a secret is configured', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(false);
  });

  it('accepts a token the siteverify endpoint confirms', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('rejects a token siteverify reports as failed', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });

  it('fails open when siteverify is unreachable', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('fails open when siteverify responds with a non-OK status', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });
});
