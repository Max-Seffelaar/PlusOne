/**
 * Universal links (iOS) / App Links (Android) — Fase 17 S4, plan decisions 7 + 11.
 *
 * The native shell claims exactly two paths on the app origin: the auth
 * handlers an invite / magic-link / e-mail-change mail points at. Nothing else
 * — `/e/*` above all (decision 11): the guest landing must stay in the browser
 * even for a promoter who has the app installed.
 *
 * Everything that would change with an Apple org-account switch or a new
 * domain lives in the constants below: the association files
 * (`/.well-known/*` route handlers), the in-app `appUrlOpen` filter and the
 * unit tests all read them from here. The native manifests
 * (AndroidManifest.xml intent-filter, ios/App/App/App.entitlements) repeat the
 * host and paths by necessity; `tests/unit/app-links.test.ts` pins them to
 * these constants.
 */
import { z } from 'zod';

/** Apple Developer Team ID (Max, 2026-09-28). Public by design: it is in every AASA file. */
export const APPLE_TEAM_ID = '52ZZ6F5V5Y';

/** The permanent app id (plan decision 13) — must equal `appId` in capacitor.config.ts. */
export const NATIVE_APP_ID = 'app.plusone.guestlist';

/** The one host the native shell loads (capacitor.config.ts PROD_SERVER_URL). */
export const APP_LINK_HOST = 'app.plus-one.io';

/**
 * The claimed paths, matched EXACTLY (no prefix): `/auth/confirmX` or
 * `/auth/confirm/../x` is not an auth link and must not open the app. Query
 * strings are unrestricted; the handlers validate them (token_hash/type/code
 * and the `next=` open-redirect guard in `safeNextPath`).
 */
export const APP_LINK_PATHS = ['/auth/confirm', '/auth/callback'] as const;

/** `apple-app-site-association` body. Components are first-match-wins. */
export function appleAppSiteAssociation(): {
  applinks: { details: { appIDs: string[]; components: Record<string, unknown>[] }[] };
} {
  return {
    applinks: {
      details: [
        {
          appIDs: [`${APPLE_TEAM_ID}.${NATIVE_APP_ID}`],
          components: [
            // Explicit, although the catch-all below already covers it: the
            // guest landing never opens the app (decision 11).
            { '/': '/e/*', exclude: true, comment: 'Guest landing stays in the browser' },
            ...APP_LINK_PATHS.map((path) => ({ '/': path, comment: 'Auth link handler' })),
            { '/': '*', exclude: true, comment: 'Everything else stays in the browser' },
          ],
        },
      ],
    },
  };
}

/** One SHA-256 certificate fingerprint as Play Console prints it: 32 bytes, `AA:BB:…`. */
export const certFingerprintSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[0-9A-F]{2}(?::[0-9A-F]{2}){31}$/, 'expected 32 colon-separated hex bytes');

/**
 * Parse `ANDROID_APP_LINK_SHA256` (comma-separated: the Play App Signing key +
 * the upload key). Returns null when the value is absent, empty or contains
 * ANY malformed entry — the route then 404s. Failing closed matters: an empty
 * or partial statement is worse than none (Android caches a failed
 * verification; a half-right list silently drops one signing key).
 */
export function parseAndroidFingerprints(raw: string | undefined): string[] | null {
  const entries = (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (entries.length === 0) return null;
  const parsed = z.array(certFingerprintSchema).safeParse(entries);
  if (!parsed.success) return null;
  return [...new Set(parsed.data)];
}

/** `assetlinks.json` body for the given (already validated) fingerprints. */
export function androidAssetLinks(fingerprints: readonly string[]): {
  relation: string[];
  target: { namespace: 'android_app'; package_name: string; sha256_cert_fingerprints: string[] };
}[] {
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: NATIVE_APP_ID,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}

/**
 * The in-app target for a URL the OS handed to the native shell
 * (`appUrlOpen` / launch URL), or null to ignore it.
 *
 * Accepts ONLY `https://app.plus-one.io` (no port, no userinfo) with a
 * pathname exactly equal to one of APP_LINK_PATHS after WHATWG URL
 * normalisation (dot segments resolved, host lower-cased). Percent-encoded
 * paths are NOT decoded, so `/auth/%63onfirm` or `/auth/confirm%2F..` do not
 * match. Returns a same-origin RELATIVE path + query (the fragment is
 * dropped: neither handler reads it), so the navigation can never leave the
 * origin the webview is on. The handler's own `next=` guard still applies.
 */
export function appLinkTarget(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 4096) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== APP_LINK_HOST || url.port !== '') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (!(APP_LINK_PATHS as readonly string[]).includes(url.pathname)) return null;
  return url.pathname + url.search;
}
