/** @type {import('next').NextConfig} */
// PWA disabled for now — will re-enable in fase 9 (door app)
// const withPWA = require('next-pwa')({
//   dest: 'public',
//   register: true,
//   skipWaiting: true,
// });

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

module.exports = nextConfig;
// Re-enable PWA in fase 9: module.exports = withPWA(nextConfig);
