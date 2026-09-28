#!/usr/bin/env node
/**
 * `capacitor:copy:after` hook (Fase 17 N7): stamp the synced app origin into the
 * copied Android offline page.
 *
 * `native/www/offline.html` (the `server.errorPath` page) auto-reloads to
 * `<origin>/app` when the connection returns. It runs from https://localhost with
 * no bridge, so it cannot read the Capacitor config at runtime — the origin has
 * to be baked in. The committed file carries the production origin; this hook
 * rewrites only the COPY in the (gitignored) native assets, using the
 * `server.url` Capacitor actually synced — so a `CAP_SERVER_URL=… npx cap sync`
 * debug build recovers to its own server, and a plain sync restores prod.
 *
 * Capacitor passes the resolved config as JSON in CAPACITOR_CONFIG and the
 * platform in CAPACITOR_PLATFORM_NAME (see @capacitor/cli runPlatformHook).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const META_RE = /(<meta name="plusone-app-origin" content=")[^"]*(" \/>)/;

/** The http(s) origin of the synced `server.url`, or null when absent/invalid. */
export function appOriginFromConfig(configJson) {
  let config;
  try {
    config = JSON.parse(configJson ?? '');
  } catch {
    return null;
  }
  const raw = config?.server?.url;
  if (typeof raw !== 'string') return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** `html` with the app-origin meta set to `origin`. Throws if the meta is missing
 *  — a silently un-stamped page would reload a debug build into prod. */
export function withAppOrigin(html, origin) {
  if (!META_RE.test(html)) throw new Error('offline.html has no plusone-app-origin meta tag');
  return html.replace(META_RE, `$1${origin}$2`);
}

/** Where `npx cap copy` puts webDir for each platform. */
export function copiedOfflinePage(rootDir, platform) {
  if (platform === 'android') return resolve(rootDir, 'android/app/src/main/assets/public/offline.html');
  if (platform === 'ios') return resolve(rootDir, 'ios/App/App/public/offline.html');
  return null;
}

function main() {
  const platform = process.env.CAPACITOR_PLATFORM_NAME;
  const rootDir = process.env.CAPACITOR_ROOT_DIR ?? process.cwd();
  const target = copiedOfflinePage(rootDir, platform);
  if (!target || !existsSync(target)) return; // web platform, or nothing copied
  const origin = appOriginFromConfig(process.env.CAPACITOR_CONFIG);
  if (!origin) throw new Error('offline-origin: no valid server.url in CAPACITOR_CONFIG');
  writeFileSync(target, withAppOrigin(readFileSync(target, 'utf8'), origin));
  console.log(`[offline-origin] ${platform}: offline.html → ${origin}/app`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
