// Coverage for 86ey2czr6: verifyTurnstileToken's keyless dev/CI stance
// (mirrors the billing stub provider), its fail-OPEN posture on
// infra/network/timeout failures, and its fail-CLOSED posture on a genuine
// rejection, a missing token, or a hostname mismatch (token-farming defense).
import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadVerify() {
  vi.resetModules();
  return import('./turnstile');
}

function stubBothKeys(): void {
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'pk_test');
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyTurnstileToken — keyless / misconfigured env', () => {
  it('passes open with no token when neither env var is set (keyless)', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(true);
  });

  it('passes open (logged) when only the secret is set — half-configured, not "on"', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', 'sk_test');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('NEXT_PUBLIC_TURNSTILE_SITE_KEY'));
  });

  it('passes open (logged) when only the site key is set', async () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'pk_test');
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('TURNSTILE_SECRET_KEY'));
  });
});

describe('verifyTurnstileToken — token presence', () => {
  it('fails closed on a missing token once both env vars are configured', async () => {
    stubBothKeys();
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken(undefined)).resolves.toBe(false);
  });
});

describe('verifyTurnstileToken — siteverify success + hostname check', () => {
  it('accepts a token siteverify confirms, no requestHost supplied to compare', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'evil.example' }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('accepts a token whose hostname matches the request host', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'plusone.example' }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(
      verifyTurnstileToken('tok', { requestHost: 'plusone.example' }),
    ).resolves.toBe(true);
  });

  it('fails closed when the token was solved on a different hostname (token farming)', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true, hostname: 'attacker.example' }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(
      verifyTurnstileToken('tok', { requestHost: 'plusone.example' }),
    ).resolves.toBe(false);
  });

  it('sends remoteip in the form body when supplied', async () => {
    stubBothKeys();
    const fetchMock = vi.fn<[string, RequestInit], Promise<Response>>(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { verifyTurnstileToken } = await loadVerify();
    await verifyTurnstileToken('tok', { remoteIp: '203.0.113.5' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init.body as URLSearchParams).get('remoteip')).toBe('203.0.113.5');
  });
});

describe('verifyTurnstileToken — error-codes classification', () => {
  it('fails closed on a genuine verdict (invalid-input-response)', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-response'] }), { status: 200 }),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });

  it('fails closed on timeout-or-duplicate (real verdict, not infra)', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['timeout-or-duplicate'] }), { status: 200 }),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });

  it('fails closed on missing-input-response', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['missing-input-response'] }), { status: 200 }),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });

  it('fails open on invalid-input-secret (rotated/mistyped secret — infra, not a verdict)', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['invalid-input-secret'] }), { status: 200 }),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('fails open on internal-error (Cloudflare-side outage)', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: false, 'error-codes': ['internal-error'] }), { status: 200 }),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('fails closed when codes mix an infra code with a genuine verdict', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ success: false, 'error-codes': ['internal-error', 'invalid-input-response'] }),
          { status: 200 },
        ),
      ),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });

  it('fails closed when success is false with no error-codes at all', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(false);
  });
});

describe('verifyTurnstileToken — network/infra failures fail open', () => {
  it('fails open when siteverify is unreachable', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('fails open when the request is aborted by the timeout signal', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });

  it('sends an AbortSignal on the fetch call so a hang cannot block the submission forever', async () => {
    stubBothKeys();
    const fetchMock = vi.fn<[string, RequestInit], Promise<Response>>(
      async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { verifyTurnstileToken } = await loadVerify();
    await verifyTurnstileToken('tok');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('fails open when siteverify responds with a non-OK status', async () => {
    stubBothKeys();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const { verifyTurnstileToken } = await loadVerify();
    await expect(verifyTurnstileToken('tok')).resolves.toBe(true);
  });
});
