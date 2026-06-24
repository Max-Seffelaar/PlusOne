// One-off admin utility: generate a login link for an existing user WITHOUT
// sending any e-mail. Use it to unblock someone whose account exists but who
// never got a mail (e.g. an invite created before SMTP was configured): it mints
// a magic-link via the service role and PRINTS a ready-to-use link + 6-digit
// code so you can hand it over directly (Signal/WhatsApp/call). Nothing is
// e-mailed. Signups are disabled, so this never creates an account — the invite
// flow must have created it first.
//
// Creds come from .env.local or process.env: NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (+ optional NEXT_PUBLIC_APP_URL for the app origin).
// To target PRODUCTION, run it from the linked main checkout (whose .env.local
// points at prod), or pass the prod creds inline:
//
//   node scripts/invite-link.mjs someone@venue.com
//   node scripts/invite-link.mjs someone@venue.com https://app.plusone.com
//   SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
//     node scripts/invite-link.mjs someone@venue.com https://app.plusone.com

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const email = process.argv[2];
const appOriginArg = process.argv[3];
if (!email) {
  console.error('Usage: node scripts/invite-link.mjs <email> [app-origin]');
  process.exit(1);
}

// Read creds from .env.local (falls back to process.env), mirroring dev-mfa.mjs.
function env() {
  let fromFile = {};
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) fromFile[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
  const get = (k) => process.env[k] ?? fromFile[k] ?? '';
  return {
    url: get('NEXT_PUBLIC_SUPABASE_URL'),
    serviceKey: get('SUPABASE_SERVICE_ROLE_KEY'),
    appUrl: get('NEXT_PUBLIC_APP_URL'),
  };
}

const { url, serviceKey, appUrl } = env();
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local or env).');
  process.exit(1);
}

const appOrigin = (appOriginArg ?? appUrl ?? '').replace(/\/$/, '');
const isProd = !/(localhost|127\.0\.0\.1)/.test(url);
const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
if (error) {
  console.error('generateLink failed:', error.message);
  process.exit(1);
}

const tokenHash = data?.properties?.hashed_token;
const otp = data?.properties?.email_otp;

console.log(`\nTarget : ${url} ${isProd ? '(PROD)' : '(local)'}`);
console.log(`User   : ${email}`);
if (otp) {
  console.log(`\n6-digit code (enter at the login screen after typing the e-mail):\n  ${otp}`);
}
// The app verifies token_hash statelessly via /auth/confirm (no PKCE cookie
// needed for an e-mailed link), then accepts pending invites and lands at /app.
if (tokenHash && appOrigin) {
  const link = `${appOrigin}/auth/confirm?token_hash=${tokenHash}&type=magiclink&next=/app`;
  console.log(`\nOne-click login link (send this to the invitee):\n  ${link}`);
} else if (tokenHash) {
  console.log(
    `\ntoken_hash: ${tokenHash}\n  (pass the app origin as the 2nd arg, or set NEXT_PUBLIC_APP_URL,\n   to print a ready /auth/confirm?token_hash=…&type=magiclink&next=/app link.)`
  );
}
console.log('');
