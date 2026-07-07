import 'server-only';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';

// The repo-committed dev fallback. Deterministic so the local/CI throttle buckets
// stay stable across restarts — NEVER used in production (see landingIpSalt).
const DEV_SALT = 'plusone-landing-dev-salt';

/**
 * The server-side salt for landing IP hashing. In production it MUST be supplied
 * via `LANDING_IP_SALT`: falling back to the repo-committed dev constant would
 * make every stored `ip_hash` brute-forceable (C5, security review 2026-07-07).
 * Fail closed — a misconfigured prod deploy throws loudly rather than silently
 * weakening the hash. Local/dev/test keep the deterministic dev salt.
 */
export function landingIpSalt(): string {
  const salt = process.env.LANDING_IP_SALT;
  if (salt && salt.length > 0) return salt;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'LANDING_IP_SALT is not set in production — refusing to hash landing IPs with a known salt.',
    );
  }
  return DEV_SALT;
}

/**
 * SHA-256 of the request's client IP with the server-side salt, so the throttle
 * table never stores a reversible IP (CLAUDE.md §security: no PII in logs/stores).
 * Behind Vercel `x-forwarded-for` is always set; the 'no-ip' fallback only bites
 * in local/dev and still degrades gracefully.
 */
export async function landingClientIpHash(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  const ip = (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') ?? '').trim();
  return createHash('sha256').update(`${landingIpSalt()}:${ip || 'no-ip'}`).digest('hex');
}
