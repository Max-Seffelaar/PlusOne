import 'server-only';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Server-side verification of a Cloudflare Turnstile response token
 * (86ey2czr6 — bot defense on the public landing form, on top of the existing
 * DB rate limit/honeypot/dedup, which stay the hard boundary either way).
 *
 * Keyless dev/CI, same stance as the Stripe stub provider: without
 * TURNSTILE_SECRET_KEY the widget itself never renders (landing.tsx checks
 * the matching public site key), so there is no token to check — this passes
 * open rather than failing every local/CI submission.
 *
 * A siteverify network failure also fails OPEN (logged): the other layers
 * still stand, and hard-failing every submission during a Cloudflare outage
 * would be worse than the bot risk of a short, logged gap.
 */
export async function verifyTurnstileToken(token: string | undefined): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
    });
    if (!res.ok) {
      console.error('[verifyTurnstileToken] siteverify responded', res.status);
      return true;
    }
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (err) {
    console.error('[verifyTurnstileToken] siteverify request failed:', err);
    return true;
  }
}
