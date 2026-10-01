/**
 * Guards for the Codemagic iOS release pipeline (Fase 17 S1b, z8uq9m0gvn).
 *
 * codemagic.yaml only runs on Codemagic and nothing in our CI builds iOS, so these
 * text checks pin the release invariants a careless edit could silently drop:
 *   1. never triggered by a push/PR — manual or an `ios-v*` tag only;
 *   2. only commits already on main are released (first script);
 *   3. a release never ships a non-prod server (CAP_SERVER_URL refused, the synced
 *      server.url asserted to be exactly https://app.plus-one.io);
 *   4. signing is Codemagic-managed via the App Store Connect integration, and
 *      publishing uploads for TestFlight only — never an App Store submission;
 *   5. the build number is floored on TestFlight's latest (never only BUILD_NUMBER),
 *      and the marketing version moves in lockstep with Android's;
 *   6. iPhone + iPad stay in v1 (TARGETED_DEVICE_FAMILY "1,2", plan decision 10);
 *   7. push is wired for APNs-via-FCM, and a missing GoogleService-Info.plist warns
 *      until REQUIRE_GOOGLE_SERVICE_INFO makes it fatal;
 *   8. no signing secret (.p8/.p12/.mobileprovision/…) is ever tracked.
 * Checks run on the ios-release block only, so the Android workflow can never
 * satisfy them.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');
const yaml = read('codemagic.yaml');

/** One top-level workflow block (2-space key under `workflows:`), comments stripped. */
function workflow(name: string): string {
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  expect(start, `workflow ${name} missing`).toBeGreaterThan(-1);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i]) || /^\S/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start, end)
    .filter((l) => !/^\s*#/.test(l))
    .join('\n');
}

const ios = workflow('ios-release');
const android = workflow('android-release');
const pbx = read('ios/App/App.xcodeproj/project.pbxproj');

describe('codemagic.yaml ios-release', () => {
  it('is only triggered manually or by an ios-v* tag', () => {
    const events = ios.match(/events:\s*\n((?:\s+-\s+\S+\s*\n)+)/);
    expect(events, 'triggering.events missing').not.toBeNull();
    expect([...events![1].matchAll(/-\s+(\S+)/g)].map((m) => m[1])).toEqual(['tag']);
    expect(ios).toMatch(/pattern:\s*'ios-v\*'/);
    expect(ios).not.toMatch(/^\s*-\s*(push|pull_request)\s*$/m);
  });

  it('only builds commits on main, as the first script', () => {
    const first = ios.match(/scripts:\s*\n\s+-\s+name:\s*([^\n]+)\n\s+script:\s*\|\n([\s\S]*?)\n\s+-\s+name:/);
    expect(first, 'scripts missing').not.toBeNull();
    expect(first![1]).toMatch(/not on main/);
    expect(first![2]).toContain('git fetch origin main');
    expect(first![2]).toContain('git merge-base --is-ancestor HEAD origin/main');
  });

  it('refuses CAP_SERVER_URL, never sets it, and asserts the synced server.url', () => {
    expect(ios).toContain('if [ -n "${CAP_SERVER_URL+x}" ]; then');
    expect(ios).not.toMatch(/^\s*CAP_SERVER_URL\s*:/m);
    expect(ios).toMatch(/PROD_SERVER_URL:\s*https:\/\/app\.plus-one\.io\s*$/m);
    expect(ios).toContain('pnpm install --frozen-lockfile');
    expect(ios).toContain('npx cap sync ios');
    expect(ios).toContain('require("./ios/App/App/capacitor.config.json")');
    expect(ios).toContain('c.server.url !== "https://app.plus-one.io"');
    expect(ios).toContain('c.ios.limitsNavigationsToAppBoundDomains !== true');
  });

  it('signs via the App Store Connect integration, App Store distribution, permanent bundle id', () => {
    expect(ios).toMatch(/integrations:\s*\n\s+app_store_connect:\s*\S/);
    expect(ios).toMatch(/ios_signing:\s*\n\s+distribution_type:\s*app_store\s*\n\s+bundle_identifier:\s*app\.plusone\.guestlist\s*$/m);
    expect(ios).toContain('xcode-project use-profiles');
    expect(ios).toContain('xcodebuild -resolvePackageDependencies');
    expect(ios).toContain('codesign --verify --strict');
    expect(ios).toMatch(/check aps-environment .* "production"$/m);
  });

  it('uploads for TestFlight only — never submits to App Store review', () => {
    const pub = ios.match(/publishing:\s*\n([\s\S]*)$/);
    expect(pub, 'publishing missing').not.toBeNull();
    expect(pub![1]).toMatch(/app_store_connect:\s*\n\s+auth:\s*integration/);
    expect(pub![1]).toMatch(/submit_to_app_store:\s*false\s*$/m);
    expect(pub![1]).not.toMatch(/submit_to_app_store:\s*true/);
    expect(pub![1]).not.toMatch(/release_type|phased_release|cancel_previous_submissions/);
    expect(pub![1]).not.toMatch(/google_play|track:/);
  });

  it('build number = max(TestFlight latest + 1, BUILD_NUMBER), passed to the archive', () => {
    expect(ios).toContain('app-store-connect get-latest-testflight-build-number "$APP_ID"');
    expect(ios).toContain('NEXT=$((LATEST + 1))');
    expect(ios).toContain('if [ "$NEXT" -lt "$BUILD_NUMBER" ]; then NEXT="$BUILD_NUMBER"; fi');
    expect(ios).toContain('CURRENT_PROJECT_VERSION=$NEXT MARKETING_VERSION=$APP_VERSION_NAME');
    expect(ios).not.toContain('CURRENT_PROJECT_VERSION=$BUILD_NUMBER');
  });

  it('marketing version moves in lockstep with Android', () => {
    const v = (block: string) => block.match(/APP_VERSION_NAME:\s*"([^"]+)"/)?.[1];
    expect(v(ios)).toMatch(/^\d+\.\d+\.\d+$/);
    expect(v(ios)).toBe(v(android));
  });

  it('a missing GoogleService-Info.plist warns, REQUIRE_GOOGLE_SERVICE_INFO makes it fatal', () => {
    expect(ios).toMatch(/REQUIRE_GOOGLE_SERVICE_INFO:\s*"(true|false)"/);
    expect(ios).toContain('elif [ "$REQUIRE_GOOGLE_SERVICE_INFO" = "true" ]; then');
    expect(ios).toContain("PlistBuddy -c 'Print :BUNDLE_ID'");
  });
});

describe('iOS native project (S1b)', () => {
  it('stays universal: iPhone + iPad in both target configs (decision 10)', () => {
    expect(pbx.match(/TARGETED_DEVICE_FAMILY = "1,2";/g)).toHaveLength(2);
    expect(pbx).not.toMatch(/TARGETED_DEVICE_FAMILY = (1|2|"1"|"2");/);
    expect(pbx.match(/PRODUCT_BUNDLE_IDENTIFIER = app\.plusone\.guestlist;/g)).toHaveLength(2);
  });

  it('aps-environment: development for Debug, production for Release', () => {
    const ent = read('ios/App/App/App.entitlements');
    expect(ent).toMatch(/<key>aps-environment<\/key>\s*<string>\$\(APS_ENVIRONMENT\)<\/string>/);
    const settings = [...pbx.matchAll(/buildSettings = \{([\s\S]*?)\n\t\t\t\};\n\t\t\tname = (Debug|Release);/g)]
      .filter((m) => m[1].includes('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;'))
      .map((m) => [m[2], m[1].match(/APS_ENVIRONMENT = (\w+);/)?.[1]]);
    expect(Object.fromEntries(settings)).toEqual({ Debug: 'development', Release: 'production' });
  });

  it('wires APNs-via-FCM: Firebase Messaging via SPM, token forwarded, guarded configure', () => {
    expect(pbx).toContain('repositoryURL = "https://github.com/firebase/firebase-ios-sdk";');
    expect(pbx).toMatch(/kind = exactVersion;\s*version = \d+\.\d+\.\d+;/);
    expect(pbx).toContain('productName = FirebaseMessaging;');
    const app = read('ios/App/App/AppDelegate.swift');
    expect(app).toContain('Messaging.messaging().apnsToken = deviceToken');
    expect(app).toContain('NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)');
    expect(app).toMatch(/Bundle\.main\.path\(forResource: "GoogleService-Info", ofType: "plist"\) != nil/);
    const plugin = read('ios/App/App/PushConfigPlugin.swift');
    expect(plugin).toContain('public let jsName = "PlusOnePushConfig"');
    expect(read('ios/App/App/SceneDelegate.swift')).toContain('PlusOneBridgeViewController()');
    expect(pbx).toContain('PushConfigPlugin.swift in Sources');
  });

  it('declares exempt encryption (HTTPS only) so uploads skip the compliance prompt', () => {
    expect(read('ios/App/App/Info.plist')).toMatch(/<key>ITSAppUsesNonExemptEncryption<\/key>\s*<false\/>/);
  });

  it('no signing secret is tracked in git', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /\.(p8|p12|pfx|cer|certSigningRequest|mobileprovision|provisionprofile)$/i.test(f))).toEqual([]);
    const pemKeys = tracked
      .filter((f) => f && !f.includes('node_modules') && !/\.(png|jpe?g|webp|ico|woff2?|gif|pdf)$/i.test(f))
      .filter((f) => {
        try {
          // A real key: the PEM header followed by base64 key material (an App Store
          // Connect / APNs .p8 is exactly this), not a test that builds one at runtime.
          return /-----BEGIN (EC |RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/]{40,}/.test(read(f));
        } catch {
          return false;
        }
      });
    expect(pemKeys).toEqual([]);
  });
});
