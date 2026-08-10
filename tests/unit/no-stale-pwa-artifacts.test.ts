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

describe('retired next-pwa artefacts stay retired', () => {
  const sw = read('public/sw.js');

  it('serves a self-destructing stub at /sw.js, not a Workbox SW', () => {
    expect(sw).toContain('self.registration.unregister()');
    expect(sw).not.toContain('precacheAndRoute');
    expect(sw).not.toContain('workbox');
    expect(sw).not.toContain('registerRoute');
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

  it('keeps both service-worker paths out of the auth redirect', () => {
    // A 307 to /login in place of a SW script is unparseable JS: the browser keeps
    // the previously installed worker, so the stub would never take effect.
    const middleware = read('src/middleware.ts');
    expect(middleware).toContain('sw.js');
    expect(middleware).toContain('service-worker.js');
  });

  it('wipes Cache Storage on sign-out alongside IndexedDB', () => {
    const signOut = read('src/components/po/screens/settings/_shared.tsx');
    expect(signOut).toContain('clearDeviceCaches');
    expect(signOut).toContain('idbClearAll');
  });
});
