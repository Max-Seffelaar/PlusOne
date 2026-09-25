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
 * - No `allowNavigation`. Android compares host + scheme exactly, so any
 *   navigation off the server host goes to the system browser. iOS does NOT:
 *   Capacitor's check is a string prefix on `server.url`, which a lookalike host
 *   (`https://app.plus-one.io.evil.example/`) passes. On iOS the boundary is
 *   therefore WebKit's App-Bound Domains: `WKAppBoundDomains = [app.plus-one.io]`
 *   in ios/App/App/Info.plist + `limitsNavigationsToAppBoundDomains` below, so
 *   no other domain is navigated in-app or gets the bridge. Never "fix" the
 *   prefix with a trailing slash on `server.url`: on Android that breaks the
 *   WebMessageListener origin rule and silently falls back to a global
 *   JavascriptInterface.
 * - The one permitted hard-coded app origin (CLAUDE.md "never hard-code an app
 *   origin"): a native shell needs it before any code runs.
 *
 * Debug override (read at `npx cap sync` / `npx cap run` time, never at runtime):
 *   CAP_SERVER_URL=https://<preview>.vercel.app npx cap sync android
 *   CAP_SERVER_URL=http://192.168.1.20:7000   npx cap sync android   (LAN dev server)
 * Cleartext is enabled ONLY when that override is an http:// URL (Android only:
 * iOS keeps default ATS, and App-Bound Domains only admits app.plus-one.io, so an
 * iOS build against another origin also needs a local, uncommitted Info.plist
 * edit). Re-run a plain
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
  ios: {
    // Security boundary on iOS, see the header. Must stay in sync with
    // WKAppBoundDomains in ios/App/App/Info.plist.
    limitsNavigationsToAppBoundDomains: true,
    // No long-press "Open" preview: it navigates the main frame and bypasses
    // the kit's ExternalLink click handler.
    allowsLinkPreview: false,
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
    // No backgroundColor: it is ignored while the webview is edge-to-edge
    // (overlaysWebView, Android 15+), which is exactly the setup above.
    StatusBar: {
      style: 'DARK',
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
    // Push (N5): no system banner while the app is in the foreground — the web
    // app shows its own toast (push-client.tsx). Explicit so a plugin default
    // change can't start double-notifying.
    PushNotifications: {
      presentationOptions: [],
    },
  },
};

export default config;
