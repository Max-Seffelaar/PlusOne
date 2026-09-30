/**
 * Guards for the committed Capacitor native projects (Fase 17 N3, 86ey6bfdm).
 *
 * 1. Stale native paths. `npx cap sync` writes the pnpm virtual-store path —
 *    version included — into committed files (`android/capacitor.settings.gradle`,
 *    `ios/App/CapApp-SPM/Package.swift`). A `@capacitor/*` bump without a re-sync
 *    keeps the web build green and breaks both native builds on the next open.
 *    This fails CI instead: every referenced path must exist after install.
 *
 * 2. iOS navigation boundary. Capacitor on iOS treats any URL that merely
 *    STARTS WITH `server.url` as in-app (a string prefix, so
 *    `https://app.plus-one.io.evil.example/` passes) and injects the bridge
 *    into it. The boundary is WebKit's App-Bound Domains: `WKAppBoundDomains`
 *    in Info.plist + `ios.limitsNavigationsToAppBoundDomains`. Both must stay
 *    on and list exactly the `server.url` host.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { describe, it, expect } from 'vitest';
import config from '../../capacitor.config';

const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

function referencedPaths(file: string, pattern: RegExp): string[] {
  return [...read(file).matchAll(pattern)].map((m) => resolve(root, dirname(file), m[1]));
}

describe('capacitor native projects', () => {
  it('android/capacitor.settings.gradle points at installed packages (run `npx cap sync` after a bump)', () => {
    const paths = referencedPaths('android/capacitor.settings.gradle', /new File\('([^']+)'\)/g);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(p), `missing: ${p}`).toBe(true);
  });

  it('ios/App/CapApp-SPM/Package.swift points at installed packages (run `npx cap sync` after a bump)', () => {
    const paths = referencedPaths('ios/App/CapApp-SPM/Package.swift', /path: "([^"]+)"/g);
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) expect(existsSync(p), `missing: ${p}`).toBe(true);
  });

  it('pins the iOS swift-pm Capacitor version to the installed @capacitor/ios', () => {
    const iosVersion = (JSON.parse(read('node_modules/@capacitor/ios/package.json')) as { version: string }).version;
    expect(read('ios/App/CapApp-SPM/Package.swift')).toContain(`capacitor-swift-pm.git", exact: "${iosVersion}"`);
  });
});

describe('iOS navigation boundary (App-Bound Domains)', () => {
  it('loads the production origin by default, https only, no allowNavigation', () => {
    if (!process.env.CAP_SERVER_URL) expect(config.server?.url).toBe('https://app.plus-one.io');
    expect(config.server?.allowNavigation ?? []).toEqual([]);
  });

  it('limits navigation to app-bound domains and disables link previews', () => {
    expect(config.ios?.limitsNavigationsToAppBoundDomains).toBe(true);
    expect(config.ios?.allowsLinkPreview).toBe(false);
  });

  it('Info.plist WKAppBoundDomains lists exactly the production host', () => {
    const plist = read('ios/App/App/Info.plist');
    const block = plist.match(/<key>WKAppBoundDomains<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(block, 'WKAppBoundDomains missing from Info.plist').not.toBeNull();
    const domains = [...block![1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1].trim());
    expect(domains).toEqual(['app.plus-one.io']);
  });
});

// N7 (decision 15): the Android offline page. Capacitor loads `server.errorPath`
// for every failed MAIN-FRAME load (network or HTTP error, first launch or
// mid-session) — without it the WebView sat on a dead error page until the app
// was killed. It runs from https://localhost with no bridge and no network.
describe('Android offline page (server.errorPath)', () => {
  const html = read('native/www/offline.html');

  it('is configured as the Android error page and shipped in webDir', () => {
    expect(config.server?.errorPath).toBe('offline.html');
    expect(config.webDir).toBe('native/www');
    expect(existsSync(resolve(root, 'native/www/offline.html'))).toBe(true);
  });

  it('is self-contained: no external script, stylesheet, font, image or frame', () => {
    expect(html).not.toMatch(/<script[^>]+src=/i);
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<(img|iframe|object|embed)\b/i);
    expect(html).not.toMatch(/@import|url\(/i);
  });

  it('holds no data: no storage of anything but its own retry counter, no credentials', () => {
    expect(html).not.toMatch(/localStorage|indexedDB|document\.cookie/);
    expect(html).toMatch(/credentials: 'omit'/);
  });

  it('commits the production origin and reloads into /app, with a Try again action', () => {
    expect(html).toContain('<meta name="plusone-app-origin" content="https://app.plus-one.io" />');
    expect(html).toContain("ORIGIN + '/app'");
    expect(html).toMatch(/>Try again</);
    expect(html).toMatch(/addEventListener\('online'/);
  });

  it('accepts only an http(s) origin from the stamped meta — IPv6 debug hosts included (§6 review)', () => {
    const src = /raw && (\/\^https\?.*?\$\/)\.test\(raw\)/.exec(html)?.[1];
    expect(src).toBeTruthy();
    const originRe = new Function(`return ${src};`)() as RegExp;
    for (const ok of ['https://app.plus-one.io', 'http://10.0.2.2:7000', 'http://[::1]:7000', 'http://[fe80::1]']) {
      expect(originRe.test(ok), ok).toBe(true);
    }
    for (const bad of [
      'https://app.plus-one.io/app',
      'javascript:alert(1)',
      'https://evil.test?x',
      'https://a"b.test',
      'http://[::1]"><script>',
      '',
    ]) {
      expect(originRe.test(bad), bad).toBe(false);
    }
  });

  it('tells "server trouble" apart from "no connection" once the probe gets through', () => {
    expect(html).toMatch(/SERVER_TROUBLE_AFTER/);
    expect(html).toMatch(/Server trouble/);
    expect(html).toMatch(/if \(up\) showServerTrouble\(\)/);
  });

  it('asks for ACCESS_NETWORK_STATE, or WebView never fires online/offline', () => {
    expect(read('android/app/src/main/AndroidManifest.xml')).toContain(
      'android.permission.ACCESS_NETWORK_STATE',
    );
  });

  it('is stamped with the synced server origin by the capacitor:copy:after hook', async () => {
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['capacitor:copy:after']).toBe('node scripts/native/offline-origin.mjs');

    const { appOriginFromConfig, withAppOrigin, copiedOfflinePage } = await import(
      '../../scripts/native/offline-origin.mjs'
    );
    expect(appOriginFromConfig(JSON.stringify({ server: { url: 'https://app.plus-one.io' } }))).toBe(
      'https://app.plus-one.io',
    );
    expect(appOriginFromConfig(JSON.stringify({ server: { url: 'http://192.168.1.20:7000/x?y' } }))).toBe(
      'http://192.168.1.20:7000',
    );
    expect(appOriginFromConfig(JSON.stringify({ server: { url: 'javascript:alert(1)' } }))).toBeNull();
    expect(appOriginFromConfig('not json')).toBeNull();
    expect(appOriginFromConfig(JSON.stringify({}))).toBeNull();

    const stamped = withAppOrigin(html, 'https://preview.example.app');
    expect(stamped).toContain('<meta name="plusone-app-origin" content="https://preview.example.app" />');
    expect(() => withAppOrigin('<html></html>', 'https://x.test')).toThrow();

    expect(copiedOfflinePage('/r', 'android')).toBe('/r/android/app/src/main/assets/public/offline.html');
    expect(copiedOfflinePage('/r', 'web')).toBeNull();
  });
});
