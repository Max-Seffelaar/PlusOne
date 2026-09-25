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

// iOS counterpart of Android's allowBackup=false + data_extraction_rules.xml:
// the webview's cookies and the door's IndexedDB snapshot (guest PII) must stay
// out of iCloud/Finder backups (CLAUDE.md device-storage rule, 86ey6bfdm).
describe('webview data is excluded from device backups', () => {
  it('iOS AppDelegate marks Library/WebKit, Cookies and HTTPStorages isExcludedFromBackup at launch', () => {
    const swift = read('ios/App/App/AppDelegate.swift');
    const launch = swift.match(/didFinishLaunchingWithOptions[\s\S]*?return true/);
    expect(launch, 'didFinishLaunchingWithOptions missing').not.toBeNull();
    expect(launch![0]).toContain('excludeWebDataFromBackup()');

    const fn = swift.match(/func excludeWebDataFromBackup\(\)[\s\S]*?\n {4}\}\n/);
    expect(fn, 'excludeWebDataFromBackup() missing').not.toBeNull();
    expect(fn![0]).toContain('.libraryDirectory');
    expect(fn![0]).toMatch(/\["WebKit", "Cookies", "HTTPStorages"\]/);
    expect(fn![0]).toContain('isExcludedFromBackup = true');
    expect(fn![0]).toContain('setResourceValues(values)');
  });

  it('Android keeps allowBackup off with the data-extraction rules', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });
});
