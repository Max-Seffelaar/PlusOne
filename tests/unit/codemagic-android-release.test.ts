/**
 * Guards for the Codemagic Android release pipeline (Fase 17 S1a, 86ey6bfpy).
 *
 * codemagic.yaml only runs on Codemagic, so nothing in our CI executes it. These
 * text checks pin the release invariants a careless edit could silently drop:
 *   1. never triggered by a push/PR — manual or an `android-v*` tag only;
 *   2. a release never ships a non-prod server (CAP_SERVER_URL guard stays, and the
 *      YAML never sets it);
 *   3. signing + the Play credential come from Codemagic, never the repo;
 *   4. versionCode = BUILD_NUMBER, publishing targets the internal track.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const root = resolve(__dirname, '../..');
const yaml = readFileSync(resolve(root, 'codemagic.yaml'), 'utf8');
// Active config only: the commented-out iOS placeholder must not satisfy a check.
const active = yaml
  .split('\n')
  .filter((l) => !/^\s*#/.test(l))
  .join('\n');
const gradle = readFileSync(resolve(root, 'android/app/build.gradle'), 'utf8');

describe('codemagic.yaml android-release', () => {
  it('is only triggered manually or by an android-v* tag', () => {
    const events = active.match(/events:\s*\n((?:\s+-\s+\S+\s*\n)+)/);
    expect(events, 'triggering.events missing').not.toBeNull();
    expect([...events![1].matchAll(/-\s+(\S+)/g)].map((m) => m[1])).toEqual(['tag']);
    expect(active).toMatch(/pattern:\s*'android-v\*'/);
    expect(active).not.toMatch(/\b(push|pull_request)\b\s*$/m);
  });

  it('refuses CAP_SERVER_URL and never sets it', () => {
    expect(active).toContain('if [ -n "${CAP_SERVER_URL+x}" ]; then');
    expect(active).not.toMatch(/^\s*CAP_SERVER_URL\s*:/m);
    expect(active).toMatch(/PROD_SERVER_URL:\s*https:\/\/app\.plus-one\.io\s*$/m);
  });

  it('signs via a Codemagic keystore reference and publishes with an env-group credential', () => {
    expect(active).toMatch(/android_signing:\s*\n(?:\s+#.*\n)*\s+-\s+plusone_upload_key/);
    expect(active).toMatch(/credentials:\s*\$GOOGLE_PLAY_SERVICE_ACCOUNT_CREDENTIALS/);
    expect(active).toMatch(/track:\s*internal\s*$/m);
    expect(active).toContain('jarsigner -verify');
  });

  it('versionCode comes from BUILD_NUMBER, read by build.gradle', () => {
    expect(active).toContain('export PLUSONE_VERSION_CODE="$BUILD_NUMBER"');
    expect(gradle).toContain("System.getenv('PLUSONE_VERSION_CODE')");
    expect(gradle).toContain('versionCode plusoneVersionCode');
    expect(gradle).toContain("System.getenv('CM_KEYSTORE_PATH')");
  });

  it('no keystore or service-account key is tracked in git', () => {
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
    expect(tracked.filter((f) => /\.(jks|keystore|p12|pem)$/i.test(f))).toEqual([]);
    const jsonKeys = tracked
      .filter((f) => f.endsWith('.json') && !f.includes('node_modules'))
      .filter((f) => {
        try {
          return readFileSync(resolve(root, f), 'utf8').includes('"private_key"');
        } catch {
          return false;
        }
      });
    expect(jsonKeys).toEqual([]);
  });
});
