/** @type {import('next').NextConfig} */
const { withSentryConfig } = require('@sentry/nextjs');

// NO next-pwa — do not wire it in. Fase 9 shipped a hand-written service worker
// instead (public/service-worker.js, registered from /door only). Its generated
// Workbox SW cached cross-origin GETs — Supabase REST bodies with guest PII — in
// an origin-scoped cache that outlived sign-out on shared door tablets, and its
// leftover output at public/sw.js kept running on real browsers for months
// (86ey9e9mn). The dependency is still in package.json pending a lockfile change;
// this comment and tests/unit/no-stale-pwa-artifacts.test.ts are what keep it inert.

const isDev = process.env.NODE_ENV !== 'production';

// connect-src must reach Supabase: hosted over https/wss (incl. Realtime),
// and the LOCAL stack over http/ws during development. Without the local
// entries the browser blocks every auth call against 127.0.0.1 in dev.
const connectSrc = isDev
  ? "'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://*.supabase.co wss://*.supabase.co"
  : "'self' https://*.supabase.co wss://*.supabase.co";

// Next dev tooling (HMR / React Refresh) needs 'unsafe-eval'; production does not.
const scriptSrc = isDev
  ? "'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'"
  : "'self' 'unsafe-inline' 'wasm-unsafe-eval'";

const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src ${connectSrc}`,
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: false, // Disabled temporarily to debug hydration issues
  images: {
    unoptimized: true,
  },
  // The desktop "(app)" dashboard shell was retired — there is one responsive
  // surface now (po `/app`). Its old routes fold into /app. /eventday followed
  // in the T9 fold: the Event-dag cockpit is now the desktop Deur tab inside /app.
  redirects: async () => [
    { source: '/dashboard', destination: '/app', permanent: false },
    { source: '/events', destination: '/app', permanent: false },
    { source: '/events/:path*', destination: '/app', permanent: false },
    { source: '/admin/:path*', destination: '/app', permanent: false },
    { source: '/settings/:path*', destination: '/app', permanent: false },
    { source: '/eventday', destination: '/app', permanent: false },
  ],
  headers: async () => {
    const headers = [
      {
        key: 'X-Frame-Options',
        value: 'DENY',
      },
      {
        key: 'X-Content-Type-Options',
        value: 'nosniff',
      },
      {
        key: 'Referrer-Policy',
        value: 'strict-origin-when-cross-origin',
      },
      {
        key: 'Content-Security-Policy',
        value: csp,
      },
    ];
    // HSTS only makes sense over HTTPS (i.e. not local http dev).
    if (!isDev) {
      headers.push({
        key: 'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }
    return [{ source: '/:path*', headers }];
  },
};

// Sentry wraps the config last (D2): same-origin tunnel + build-time source-map
// upload. No secrets here — hardcoded org/project fallbacks keep CI/local builds
// working without env; the Vercel marketplace integration injects the real
// SENTRY_ORG/SENTRY_PROJECT/SENTRY_AUTH_TOKEN and env wins.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG || 'plus-one-hs', // fase 7.2 — verify the real org slug
  project: process.env.SENTRY_PROJECT || 'javascript-nextjs',
  authToken: process.env.SENTRY_AUTH_TOKEN, // build-time only, NEVER NEXT_PUBLIC
  silent: !process.env.CI,
  telemetry: false,
  widenClientFileUpload: true,
  tunnelRoute: '/monitoring', // D2 — same-origin ingest (needs the middleware exclusion)
  webpack: {
    treeshake: { removeDebugLogging: true }, // strips Sentry debug logs from the bundle
    automaticVercelMonitors: false, // no cron monitors in v1
  },
  sourcemaps: {
    deleteSourcemapsAfterUpload: true, // never serve .map files publicly
    disable: !process.env.SENTRY_AUTH_TOKEN, // no token (CI/local) → upload skips silently
  },
});
