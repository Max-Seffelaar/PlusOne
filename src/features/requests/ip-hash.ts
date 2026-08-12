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

async function rawClientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : h.get('x-real-ip') ?? '').trim();
}

/**
 * SHA-256 of the request's client IP with the server-side salt, so the throttle
 * table never stores a reversible IP (CLAUDE.md §security: no PII in logs/stores).
 * Behind Vercel `x-forwarded-for` is always set; the 'no-ip' fallback only bites
 * in local/dev and still degrades gracefully.
 */
export async function landingClientIpHash(): Promise<string> {
  const ip = await rawClientIp();
  return createHash('sha256').update(`${landingIpSalt()}:${ip || 'no-ip'}`).digest('hex');
}

/**
 * Raw (unhashed) client IP, ONLY for the Turnstile siteverify `remoteip` field
 * (86ey2czr6) — Cloudflare uses it purely as a cross-check on the token it
 * already issued, never returned to the caller or persisted. Never log or
 * store this value anywhere new (CLAUDE.md §security: no PII in logs/stores);
 * every other consumer must keep using landingClientIpHash().
 */
export async function landingClientIpForVerify(): Promise<string | undefined> {
  const ip = await rawClientIp();
  return ip || undefined;
}
