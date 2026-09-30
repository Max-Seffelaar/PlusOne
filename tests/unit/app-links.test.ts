/**
 * Universal links / App Links (Fase 17 S4, plan decisions 7 + 11): the two
 * association routes, the in-app `appUrlOpen` URL filter, the middleware
 * matcher and the native manifests. The claim is ONLY /auth/confirm +
 * /auth/callback — never /e/* (the guest landing stays in the browser).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import capConfig from '../../capacitor.config';
import { middlewareMatcher } from './helpers/middleware-matcher';
import {
  APP_LINK_HOST,
  APP_LINK_PATHS,
  APPLE_TEAM_ID,
  NATIVE_APP_ID,
  appLinkTarget,
  parseAndroidFingerprints,
} from '@/lib/native/app-links';
import { GET as getAasa } from '@/app/.well-known/apple-app-site-association/route';
import { GET as getAssetLinks } from '@/app/.well-known/assetlinks.json/route';

const root = resolve(__dirname, '../..');
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8');

const FP_A = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP_B = Array.from({ length: 32 }, () => 'AB').join(':');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('constants', () => {
  it('app id matches the permanent Capacitor appId', () => {
    expect(NATIVE_APP_ID).toBe(capConfig.appId);
  });

  it('app-link host is the production server.url host', () => {
    if (!process.env.CAP_SERVER_URL) expect(new URL(capConfig.server!.url!).host).toBe(APP_LINK_HOST);
    expect(APP_LINK_HOST).toBe('app.plus-one.io');
  });

  it('claims only the two auth handlers', () => {
    expect([...APP_LINK_PATHS]).toEqual(['/auth/confirm', '/auth/callback']);
  });
});

describe('GET /.well-known/apple-app-site-association', () => {
  it('serves 200 application/json with the team-prefixed app id', async () => {
    const res = getAasa();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    const body = (await res.json()) as {
      applinks: { details: { appIDs: string[]; components: { '/': string; exclude?: boolean }[] }[] };
    };
    expect(body.applinks.details).toHaveLength(1);
    expect(body.applinks.details[0].appIDs).toEqual([`${APPLE_TEAM_ID}.app.plusone.guestlist`]);
    expect(APPLE_TEAM_ID).toBe('52ZZ6F5V5Y');
    expect(body).not.toHaveProperty('webcredentials');
  });

  it('includes exactly /auth/confirm + /auth/callback and excludes everything else', async () => {
    const body = (await getAasa().json()) as {
      applinks: { details: { components: { '/': string; exclude?: boolean }[] }[] };
    };
    const components = body.applinks.details[0].components;
    const included = components.filter((c) => !c.exclude).map((c) => c['/']);
    expect(included).toEqual(['/auth/confirm', '/auth/callback']);
    // No include pattern can match the guest landing.
    for (const p of included) expect(p.startsWith('/e')).toBe(false);
    // /e/* is excluded explicitly, before any include (first match wins)…
    expect(components[0]).toMatchObject({ '/': '/e/*', exclude: true });
    // …and the catch-all exclude is last.
    expect(components[components.length - 1]).toMatchObject({ '/': '*', exclude: true });
    expect(JSON.stringify(body)).not.toMatch(/"\/e\/[^*]/);
  });
});

describe('GET /.well-known/assetlinks.json', () => {
  it('404s when ANDROID_APP_LINK_SHA256 is unset', async () => {
    const saved = process.env.ANDROID_APP_LINK_SHA256;
    delete process.env.ANDROID_APP_LINK_SHA256;
    const res = getAssetLinks();
    if (saved !== undefined) process.env.ANDROID_APP_LINK_SHA256 = saved;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('404s when it is empty or only separators', () => {
    for (const v of ['', '   ', ',', ' , , ']) {
      vi.stubEnv('ANDROID_APP_LINK_SHA256', v);
      expect(getAssetLinks().status).toBe(404);
    }
  });

  it('404s (never a partial statement) when any fingerprint is malformed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const v of [
      '*',
      'AB:CD',
      `${FP_A},not-a-fingerprint`,
      FP_A.replace(/:/g, ''),
      `${FP_A}:00`,
      FP_A.replace('00', 'ZZ'),
    ]) {
      vi.stubEnv('ANDROID_APP_LINK_SHA256', v);
      expect(getAssetLinks().status, v).toBe(404);
    }
  });

  it('serves the statement for the configured fingerprints', async () => {
    vi.stubEnv('ANDROID_APP_LINK_SHA256', ` ${FP_A.toLowerCase()} , ${FP_B} `);
    const res = getAssetLinks();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.json()).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: 'app.plusone.guestlist',
          sha256_cert_fingerprints: [FP_A, FP_B],
        },
      },
    ]);
  });

  it('dedupes repeated fingerprints', () => {
    expect(parseAndroidFingerprints(`${FP_A},${FP_A.toLowerCase()}`)).toEqual([FP_A]);
  });
});

describe('appLinkTarget (appUrlOpen filter)', () => {
  it.each([
    ['https://app.plus-one.io/auth/confirm?token_hash=abc&type=invite', '/auth/confirm?token_hash=abc&type=invite'],
    ['https://app.plus-one.io/auth/callback?code=xyz&next=%2Fapp', '/auth/callback?code=xyz&next=%2Fapp'],
    ['https://app.plus-one.io/auth/confirm', '/auth/confirm'],
    ['https://APP.Plus-One.io/auth/confirm?x=1', '/auth/confirm?x=1'],
    ['https://app.plus-one.io:443/auth/confirm', '/auth/confirm'],
    // Fragment is dropped; next= is passed through for the handler's own guard.
    ['https://app.plus-one.io/auth/confirm?next=https://evil.com#frag', '/auth/confirm?next=https://evil.com'],
    // Dot segments are normalised by the URL parser BEFORE the path check.
    ['https://app.plus-one.io/app/../auth/confirm?x=1', '/auth/confirm?x=1'],
  ])('allows %s', (raw, expected) => {
    expect(appLinkTarget(raw)).toBe(expected);
  });

  it.each([
    // lookalike / other hosts
    'https://app.plus-one.io.evil.com/auth/confirm',
    'https://evil.com/app.plus-one.io/auth/confirm',
    'https://evil.com/auth/confirm?host=app.plus-one.io',
    'https://plus-one.io/auth/confirm',
    'https://www.plus-one.io/auth/confirm',
    'https://sub.app.plus-one.io/auth/confirm',
    'https://app.plus-one.io@evil.com/auth/confirm',
    'https://user:pass@app.plus-one.io/auth/confirm',
    'https://app.plus-one.io:8443/auth/confirm',
    // wrong scheme
    'http://app.plus-one.io/auth/confirm',
    'javascript:alert(1)//https://app.plus-one.io/auth/confirm',
    'plusone://app.plus-one.io/auth/confirm',
    'intent://app.plus-one.io/auth/confirm#Intent;scheme=https;end',
    'file:///auth/confirm',
    'data:text/html,https://app.plus-one.io/auth/confirm',
    // unclaimed paths — the guest landing above all
    'https://app.plus-one.io/e/some-slug',
    'https://app.plus-one.io/e/some-slug?next=/auth/confirm',
    'https://app.plus-one.io/',
    'https://app.plus-one.io/app',
    'https://app.plus-one.io/auth/dev-login?email=x',
    'https://app.plus-one.io/auth/review-login',
    'https://app.plus-one.io/auth/confirmx',
    'https://app.plus-one.io/auth/confirm/',
    'https://app.plus-one.io/auth/confirm/extra',
    // traversal out of the claimed path
    'https://app.plus-one.io/auth/confirm/../../app',
    'https://app.plus-one.io/auth/confirm/%2e%2e/%2e%2e/e/slug',
    'https://app.plus-one.io/auth/%2e%2e/e/slug',
    // encoded paths are not decoded into a match
    'https://app.plus-one.io/auth/%63onfirm',
    'https://app.plus-one.io/auth%2Fconfirm',
    'https://app.plus-one.io/auth/confirm%2F..%2F..%2Fapp',
    'https://app.plus-one.io/auth\\confirm/..\\..\\e',
    // not a URL at all
    '/auth/confirm',
    '//app.plus-one.io/auth/confirm',
    '',
    'not a url',
  ])('ignores %s', (raw) => {
    expect(appLinkTarget(raw)).toBeNull();
  });

  it('ignores non-strings and absurdly long input', () => {
    expect(appLinkTarget(undefined)).toBeNull();
    expect(appLinkTarget(null)).toBeNull();
    expect(appLinkTarget({ url: 'https://app.plus-one.io/auth/confirm' })).toBeNull();
    expect(appLinkTarget(`https://app.plus-one.io/auth/confirm?x=${'a'.repeat(5000)}`)).toBeNull();
  });

  it('always returns a same-origin relative path', () => {
    const out = appLinkTarget('https://app.plus-one.io/auth/callback?next=//evil.com');
    expect(out).toBe('/auth/callback?next=//evil.com');
    // Resolved against any origin, it stays on that origin and that path.
    const resolved = new URL(out!, 'https://preview.example');
    expect(resolved.origin).toBe('https://preview.example');
    expect(resolved.pathname).toBe('/auth/callback');
  });
});

describe('middleware matcher', () => {
  const matcher = middlewareMatcher;

  it('lets /.well-known/* through without the auth gate', () => {
    const m = matcher();
    expect(m.test('/.well-known/apple-app-site-association')).toBe(false);
    expect(m.test('/.well-known/assetlinks.json')).toBe(false);
  });

  it('still gates the app and the auth-adjacent surfaces', () => {
    const m = matcher();
    expect(m.test('/app')).toBe(true);
    expect(m.test('/auth/confirm')).toBe(true);
    expect(m.test('/well-known/x')).toBe(true);
    expect(m.test('/app/.well-known/x')).toBe(true);
  });
});

describe('native manifests claim only the auth paths', () => {
  it('Android: one autoVerify https filter for app.plus-one.io + exactly the auth paths', () => {
    const manifest = read('android/app/src/main/AndroidManifest.xml');
    const filters = [...manifest.matchAll(/<intent-filter([^>]*)>([\s\S]*?)<\/intent-filter>/g)];
    const viewFilters = filters.filter((f) => f[2].includes('android.intent.action.VIEW'));
    expect(viewFilters).toHaveLength(1);
    const [, attrs, body] = viewFilters[0];
    expect(attrs).toContain('android:autoVerify="true"');
    expect(body).toContain('android.intent.category.BROWSABLE');
    const values = (attr: string): string[] =>
      [...body.matchAll(new RegExp(`android:${attr}="([^"]*)"`, 'g'))].map((m) => m[1]);
    expect(values('scheme')).toEqual(['https']);
    expect(values('host')).toEqual([APP_LINK_HOST]);
    expect(values('path')).toEqual([...APP_LINK_PATHS]);
    // No prefix/pattern matchers that could widen the claim (e.g. to /e/*).
    for (const attr of ['pathPrefix', 'pathPattern', 'pathAdvancedPattern', 'pathSuffix']) {
      expect(values(attr), attr).toEqual([]);
    }
  });

  it('iOS: the entitlement claims applinks:app.plus-one.io and is wired into both configs', () => {
    const ent = read('ios/App/App/App.entitlements');
    const block = ent.match(/<key>com\.apple\.developer\.associated-domains<\/key>\s*<array>([\s\S]*?)<\/array>/);
    expect(block).not.toBeNull();
    const domains = [...block![1].matchAll(/<string>([^<]+)<\/string>/g)].map((m) => m[1].trim());
    expect(domains).toEqual([`applinks:${APP_LINK_HOST}`]);
    const pbx = read('ios/App/App.xcodeproj/project.pbxproj');
    expect(pbx.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g)).toHaveLength(2);
  });
});
