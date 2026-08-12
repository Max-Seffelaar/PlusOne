import 'server-only';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const VERIFY_TIMEOUT_MS = 3000;

// https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
// Infra-shaped codes (a rotated/mistyped secret, Cloudflare's own outage) must
// degrade to inert rather than reject every human — same "keyless passes open"
// stance as a missing secret. Everything else is a genuine verdict on the
// token itself and fails closed.
const INFRA_ERROR_CODES = new Set(['invalid-input-secret', 'internal-error']);

type SiteverifyResponse = {
  success?: boolean;
  'error-codes'?: string[];
  hostname?: string;
};

/**
 * Server-side verification of a Cloudflare Turnstile response token
 * (86ey2czr6 — bot defense on the public landing form, on top of the existing
 * DB rate limit/honeypot/dedup, which stay the hard boundary either way).
 *
 * Keyless dev/CI, same stance as the Stripe stub provider: without BOTH
 * TURNSTILE_SECRET_KEY and NEXT_PUBLIC_TURNSTILE_SITE_KEY the widget itself
 * never renders (landing.tsx checks the site key), so there is no token to
 * check — this passes open. Exactly one of the pair set is a misconfiguration
 * (not "off"), so it also passes open, loudly logged, rather than bricking
 * the only public funnel over a half-finished env setup.
 *
 * A missing/invalid TOKEN fails CLOSED once the pair is configured — passing
 * open on a missing token would mean zero bot protection whenever the client
 * script simply doesn't run, which is trivial to trigger. A siteverify
 * network/infra failure (unreachable, timeout, invalid-input-secret,
 * internal-error) fails OPEN and logs loudly: the DB rate limit/honeypot/
 * dedup still stand, and hard-failing every submission on a Cloudflare
 * outage or a rotated secret would be worse than that gap. A hostname
 * mismatch (see below) fails CLOSED — it means a real, correctly-solved
 * token, just not solved on our own page.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  opts: { remoteIp?: string; requestHost?: string } = {},
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!secret && !siteKey) return true;
  if (!secret || !siteKey) {
    console.error(
      `[verifyTurnstileToken] misconfigured: ${!secret ? 'TURNSTILE_SECRET_KEY' : 'NEXT_PUBLIC_TURNSTILE_SITE_KEY'} is missing while the other is set — passing open.`,
    );
    return true;
  }
  if (!token) return false;

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (opts.remoteIp) body.set('remoteip', opts.remoteIp);

    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[verifyTurnstileToken] siteverify responded', res.status);
      return true;
    }

    const data = (await res.json()) as SiteverifyResponse;
    if (data.success === true) {
      // hostname is the domain the widget actually rendered on, per Cloudflare
      // — comparing it to the request's own Host kills token-farming (a valid
      // token solved on an attacker-controlled page embedding our public site
      // key, then replayed against our submit action).
      if (opts.requestHost && data.hostname && data.hostname !== opts.requestHost) {
        console.error(
          '[verifyTurnstileToken] hostname mismatch:', data.hostname, 'vs', opts.requestHost,
        );
        return false;
      }
      return true;
    }

    const codes = data['error-codes'] ?? [];
    console.error('[verifyTurnstileToken] rejected:', codes);
    return codes.length > 0 && codes.every((c) => INFRA_ERROR_CODES.has(c));
  } catch (err) {
    // Covers network failure AND the AbortSignal.timeout() TimeoutError.
    console.error('[verifyTurnstileToken] siteverify request failed:', err);
    return true;
  }
}
