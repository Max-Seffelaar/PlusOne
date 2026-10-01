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

  it('offers "Continue without internet" into the Deur tab as the primary action (N7 follow-up)', () => {
    // Primary = first button in the markup; Try again stays as the secondary.
    const buttons = [...html.matchAll(/<button id="(\w+)"/g)].map((m) => m[1]);
    expect(buttons).toEqual(['continue', 'retry']);
    expect(html).toMatch(/>Continue without internet</);
    expect(html).toContain("var DOOR_TARGET = ORIGIN + '/app/door';");
    expect(html).toContain("getElementById('continue').addEventListener('click', continueOffline)");
    expect(html).toMatch(/Your device is offline\. PlusOne will load again once you have internet\./);
  });

  it('never counts a Continue tap as a reconnect attempt, so offline never reads as "Server trouble"', () => {
    const body = /function continueOffline\(\) \{([\s\S]*?)\n {8}\}/.exec(html)?.[1];
    expect(body, 'continueOffline() not found').toBeTruthy();
    expect(body).toContain('window.location.replace(DOOR_TARGET)');
    expect(body).not.toMatch(/writeAttempts|attempts|sessionStorage|go\(\)/);
    // The only writer of the counter stays the reconnect path.
    expect(html.match(/writeAttempts\(/g)).toHaveLength(2); // definition + go()
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

describe('push (Fase 17 N5)', () => {
  const manifest = () => read('android/app/src/main/AndroidManifest.xml');

  it('declares the Android 13+ runtime permission', () => {
    expect(manifest()).toContain('<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
  });

  it('the manifest default channel is the one the web app creates', async () => {
    const { PUSH_CHANNEL_ID } = await import('../../src/features/notifications/capacitor-provider');
    const values = read('android/app/src/main/res/values/plusone_push.xml');
    expect(values).toContain(`<string name="plusone_push_channel_id" translatable="false">${PUSH_CHANNEL_ID}</string>`);
    expect(manifest()).toMatch(/default_notification_channel_id"\s+android:value="@string\/plusone_push_channel_id"/);
    expect(manifest()).toMatch(/default_notification_icon"\s+android:resource="@drawable\/ic_stat_plusone"/);
    // A distinct name outside mipmap/splash, which S2's @capacitor/assets regenerates.
    expect(existsSync(resolve(root, 'android/app/src/main/res/drawable/ic_stat_plusone.xml'))).toBe(true);
  });

  it('registers the Firebase-config guard plugin before the bridge starts', () => {
    const main = read('android/app/src/main/java/app/plusone/guestlist/MainActivity.java');
    const reg = main.indexOf('registerPlugin(PushConfigPlugin.class)');
    expect(reg).toBeGreaterThan(-1);
    expect(reg).toBeLessThan(main.indexOf('super.onCreate'));
    expect(read('android/app/src/main/java/app/plusone/guestlist/PushConfigPlugin.java')).toContain('@CapacitorPlugin(name = "PlusOnePushConfig")');
  });

  it('FCM only: no Firebase Analytics or Crashlytics anywhere in the Android build', () => {
    for (const f of ['android/build.gradle', 'android/app/build.gradle', 'android/app/capacitor.build.gradle', 'android/variables.gradle']) {
      expect(read(f), f).not.toMatch(/firebase-analytics|firebase-crashlytics|crashlytics/i);
    }
  });

  it('the google-services plugin stays conditional, so a build without google-services.json still works', () => {
    expect(read('android/app/build.gradle')).toMatch(/file\('google-services\.json'\)[\s\S]*apply plugin: 'com\.google\.gms\.google-services'/);
  });

  it('no system banner in the foreground: the app shows its own toast', () => {
    expect(config.plugins?.PushNotifications).toEqual({ presentationOptions: [] });
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

  it('iOS re-applies the exclusion when the scene enters the background (UIScene lifecycle)', () => {
    const scene = read('ios/App/App/SceneDelegate.swift');
    const bg = scene.match(/func sceneDidEnterBackground\(_ scene: UIScene\)[\s\S]*?\n {4}\}\n/);
    expect(bg, 'sceneDidEnterBackground missing').not.toBeNull();
    expect(bg![0]).toContain('AppDelegate.excludeWebDataFromBackup()');
    // Callable from the scene delegate: not private, and a type method.
    expect(read('ios/App/App/AppDelegate.swift')).toMatch(/\n {4}static func excludeWebDataFromBackup\(\)/);
  });

  it('Android keeps allowBackup off with the data-extraction rules', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });
});
