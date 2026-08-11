/**
 * IP-salt fail-closed guard (86ey9e9my, C5 regression).
 *
 * `/r/[token]` and `/i/[token]` each carried their own inline IP-hashing
 * helper with `process.env.LANDING_IP_SALT ?? 'plusone-landing-dev-salt'` —
 * a repo-committed fallback that silently weakens the hash in production if
 * the env var is ever missing, defeating the fail-closed guarantee
 * `landingIpSalt()` (src/features/requests/ip-hash.ts) already provides for
 * `/e/[slug]`. Two guards: a structural scan proving both routes call the
 * shared helper (and never reintroduce a local salt fallback), plus a
 * behavioral test proving the shared helper itself throws in production
 * without the env var.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ROOT = process.cwd();
const ROUTES = [
  path.join(ROOT, 'src', 'app', 'r', '[token]', 'page.tsx'),
  path.join(ROOT, 'src', 'app', 'i', '[token]', 'page.tsx'),
];

// The exact fallback pattern that reintroduces the C5 regression: a
// committed dev-salt string used as an `??` default for the env var.
const COMMITTED_SALT_FALLBACK = /LANDING_IP_SALT\s*\?\?\s*['"]/;
const USES_SHARED_HELPER = /from\s+['"]@\/features\/requests\/ip-hash['"]/;
const CALLS_SHARED_HELPER = /landingClientIpHash\(\)/;

describe('/r and /i routes use the shared fail-closed IP-hash helper', () => {
  for (const routeFile of ROUTES) {
    const rel = path.relative(ROOT, routeFile);

    it(`${rel} imports and calls landingClientIpHash from the shared helper`, () => {
      const src = readFileSync(routeFile, 'utf8');
      expect(src, `${rel} must import landingClientIpHash from @/features/requests/ip-hash`).toMatch(
        USES_SHARED_HELPER,
      );
      expect(src, `${rel} must call landingClientIpHash() to hash the request IP`).toMatch(
        CALLS_SHARED_HELPER,
      );
    });

    it(`${rel} never reintroduces a committed dev-salt fallback`, () => {
      const src = readFileSync(routeFile, 'utf8');
      expect(
        src,
        `${rel} must not fall back to a committed salt via \`LANDING_IP_SALT ?? '...'\` — ` +
          'that silently weakens the hash in production. Use landingClientIpHash() instead.',
      ).not.toMatch(COMMITTED_SALT_FALLBACK);
    });
  }
});

describe('landingIpSalt() fails closed in production without LANDING_IP_SALT', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('throws when NODE_ENV=production and LANDING_IP_SALT is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LANDING_IP_SALT', '');
    const { landingIpSalt } = await import('@/features/requests/ip-hash');
    expect(() => landingIpSalt()).toThrow(/LANDING_IP_SALT is not set in production/);
  });

  it('uses LANDING_IP_SALT when set, even in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('LANDING_IP_SALT', 'a-real-prod-salt');
    const { landingIpSalt } = await import('@/features/requests/ip-hash');
    expect(landingIpSalt()).toBe('a-real-prod-salt');
  });

  it('falls back to the deterministic dev salt outside production', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LANDING_IP_SALT', '');
    const { landingIpSalt } = await import('@/features/requests/ip-hash');
    expect(() => landingIpSalt()).not.toThrow();
    expect(typeof landingIpSalt()).toBe('string');
  });
});
