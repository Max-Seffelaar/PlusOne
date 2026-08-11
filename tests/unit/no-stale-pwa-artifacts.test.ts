/**
 * next-pwa was never re-enabled after fase 9, but its build output stayed in
 * `public/` — and a service worker is not a file you can retire by deleting it.
 * Browsers that once registered `/sw.js` keep running the INSTALLED copy, which
 * cached cross-origin GETs (Supabase REST bodies = guest PII) in an origin-scoped
 * cache that outlived sign-out. The only kill-switch is serving a stub at the
 * same path that unregisters itself (86ey9e9mn).
 *
 * This guard exists because the failure is silent: re-adding next-pwa, or
 * regenerating `public/sw.js`, would overwrite the stub with a fresh Workbox SW
 * and nothing else in CI would notice.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = process.cwd();
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

/** The live matcher from src/middleware.ts, compiled the way Next compiles it.
 *  Asserting on the behaviour of the real pattern rather than on a substring:
 *  `toContain('sw.js')` was satisfied by the explanatory COMMENT above the
 *  matcher, so deleting the exclusion itself would have kept CI green. */
function middlewareMatcher(): RegExp {
  const src = read('src/middleware.ts');
  const line = /matcher:\s*\[\s*'([^']+)'/.exec(src);
  if (!line) throw new Error('middleware matcher not found');
  return new RegExp(`^${line[1]}$`);
}

describe('retired next-pwa artefacts stay retired', () => {
  const sw = read('public/sw.js');

  it('serves a self-destructing stub at /sw.js, not a Workbox SW', () => {
    expect(sw).toContain('self.registration.unregister()');
    expect(sw).not.toContain('precacheAndRoute');
    expect(sw).not.toContain('registerRoute');
    // The stub's own comments mention workbox, so assert on code, not prose.
    expect(sw).not.toMatch(/^(?!\s*(\/\/|\*|\/\*)).*workbox/m);
  });

  it('ships no Workbox runtime for a stale SW to import', () => {
    expect(existsSync(resolve(root, 'public/workbox-e9849328.js'))).toBe(false);
  });

  it('never wires next-pwa into the build', () => {
    // The package is still in package.json (removing it needs a lockfile change
    // — see the changelog note); what must stay true is that nothing calls it.
    const config = read('next.config.js');
    expect(config).not.toMatch(/^\s*(?!\/\/).*require\(['"]next-pwa['"]\)/m);
    expect(config).not.toMatch(/^\s*(?!\/\/).*withPWA\s*\(/m);
  });

  it('exempts both service-worker paths from the auth matcher', () => {
    // A 307 to /login in place of a SW script is unparseable JS: the browser keeps
    // the previously installed worker, so the stub would never take effect.
    const matcher = middlewareMatcher();
    expect(matcher.test('/sw.js')).toBe(false);
    expect(matcher.test('/service-worker.js')).toBe(false);
    // …while the surfaces that DO need the auth gate still run through it.
    expect(matcher.test('/app')).toBe(true);
    expect(matcher.test('/door/evt-1')).toBe(true);
  });

  it('routes the MFA wall’s sign-out through the device wipe', () => {
    // That escape hatch is reachable on a shared door tablet; a bare
    // supabase.auth.signOut() there leaves IndexedDB and Cache Storage behind.
    const mfa = read('src/features/auth/components/MfaChallengeForm.tsx');
    expect(mfa).toContain("from '@/features/auth/sign-out-device'");
    expect(mfa).not.toMatch(/await\s+supabase\.auth\.signOut\(/);
  });
});
