/**
 * Capacitor native shell (Fase 17 N3, 86ey6bfdm; decisions #37 + plan §2).
 *
 * Remote-URL model: the native webview loads the deployed web app, so server
 * actions, auth cookies and the door outbox run unchanged. There is no local
 * web bundle — `webDir` is a committed placeholder the CLI requires
 * (native/www/index.html), never a Next export.
 *
 * - `appId` is PERMANENT (plan decision 13): it is the Android applicationId,
 *   the iOS bundle id and the Firebase app id. Never change it.
 * - The production origin lives here and nowhere else in the native config.
 * - No `allowNavigation`: any navigation off the server host leaves the webview
 *   (Capacitor hands it to the system browser), so a link to a foreign page can
 *   never run inside the shell with the bridge attached.
 *
 * Debug override (read at `npx cap sync` / `npx cap run` time, never at runtime):
 *   CAP_SERVER_URL=https://<preview>.vercel.app npx cap sync android
 *   CAP_SERVER_URL=http://192.168.1.20:7000   npx cap sync android   (LAN dev server)
 * Cleartext is enabled ONLY when that override is an http:// URL. Re-run a plain
 * `npx cap sync` before building anything you hand to someone else — the synced
 * config is copied into the native projects (gitignored), not read from git.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const PROD_SERVER_URL = 'https://app.plus-one.io';
const SHELL_BACKGROUND = '#0B0B0D'; // design-system near-black; no white flash before first paint

function resolveServerUrl(raw: string | undefined): { url: string; cleartext: boolean } {
  const value = raw?.trim();
  if (!value) return { url: PROD_SERVER_URL, cleartext: false };
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`CAP_SERVER_URL is not a valid URL: ${value}`);
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`CAP_SERVER_URL must be http(s): ${value}`);
  }
  return { url: parsed.origin, cleartext: parsed.protocol === 'http:' };
}

const server = resolveServerUrl(process.env.CAP_SERVER_URL);

const config: CapacitorConfig = {
  appId: 'app.plusone.guestlist',
  appName: 'PlusOne',
  webDir: 'native/www',
  backgroundColor: SHELL_BACKGROUND,
  server: {
    url: server.url,
    androidScheme: 'https',
    cleartext: server.cleartext,
  },
  android: {
    allowMixedContent: false,
  },
  plugins: {
    // Edge-to-edge: the web app pads the insets itself (viewport-fit=cover +
    // env(safe-area-inset-*) in the po shell). 'css' is the Capacitor 8 default;
    // pinned here so a default change can't silently double-pad the shell.
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    // Light status-bar content over the near-black app ('DARK' = light text).
    StatusBar: {
      style: 'DARK',
      backgroundColor: SHELL_BACKGROUND,
    },
    // Plain near-black launch screen, no spinner, no fade that fights the
    // design system's translateY-only motion rule.
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      launchFadeOutDuration: 0,
      backgroundColor: SHELL_BACKGROUND,
      showSpinner: false,
    },
  },
};

export default config;
