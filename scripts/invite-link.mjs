// One-off admin utility: generate a login link for an EXISTING user WITHOUT
// sending any e-mail. Use it to unblock someone whose account exists but who
// never got a usable mail: it mints a link via the service role and PRINTS a
// ready-to-use link + 6-digit code so you can hand it over directly
// (Signal/WhatsApp/call). Nothing is e-mailed.
//
// ⚠️ It refuses an address without an account, and that check is load-bearing:
// `admin.generateLink({type:'invite'})` CREATES the auth user when it does not
// exist (service role bypasses "signups disabled"), so a typo in a production
// run would otherwise mint a real account outside the invite-only invariant
// (#20) — one that could walk through /onboarding and create a venue. Do not
// remove the lookup, and do not add a tier that can provision.
//
// Creds come from .env.local or process.env: NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY (+ optional NEXT_PUBLIC_APP_URL for the app origin).
// To target PRODUCTION, run it from the linked main checkout (whose .env.local
// points at prod), or pass the prod creds inline:
//
//   node scripts/invite-link.mjs someone@venue.com
//   node scripts/invite-link.mjs someone@venue.com https://app.plus-one.io
//   SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co \
//     node scripts/invite-link.mjs someone@venue.com https://app.plus-one.io

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

// Which link type actually WORKS depends on the account's state, and getting it
// wrong is silent: for a never-confirmed invitee GoTrue happily MINTS a
// `magiclink` token and then refuses to complete it ("Email link is invalid or
// has expired"), so the operator hands out a dead link and the invitee is stuck
// again (measured on the local stack, P-01 / z8uq9m0tnq). So: look the account
// up first and mint the type that matches its state — `invite` (confirmation
// slot) for a never-confirmed account, `magiclink` for a confirmed one — with
// the other type as a fallback. `signup` is deliberately not a tier:
// admin.generateLink({type:'signup'}) requires a password and would only
// produce a misleading validation error.
//
// Minting INVALIDATES any earlier unused link in the same slot, so only ever
// hand out the newest link, and do not resend an invite afterwards.
async function findUser() {
  const res = await fetch(
    `${url.replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=1&filter=${encodeURIComponent(email)}`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  if (!res.ok) return null;
  const body = await res.json();
  const users = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => (u.email ?? '').toLowerCase() === email.toLowerCase()) ?? null;
}

const existing = await findUser();
const confirmed = Boolean(existing?.email_confirmed_at ?? existing?.confirmed_at);
if (!existing) {
  console.error(
    `No account found for ${email}. Signups are disabled — invite the address from the app first.`
  );
  process.exit(1);
}
const LINK_TYPES = confirmed ? ['magiclink', 'invite'] : ['invite', 'magiclink'];

let data = null;
let linkType = null;
let firstError = null;
for (const type of LINK_TYPES) {
  const attempt = await admin.auth.admin.generateLink({ type, email });
  if (!attempt.error && attempt.data?.properties?.hashed_token) {
    data = attempt.data;
    linkType = type;
    break;
  }
  const err = attempt.error ?? new Error('generateLink returned no token');
  // Keep the FIRST failure: it is the one that describes the account's real
  // state. A later type's error is usually just "wrong tool for this state".
  if (!firstError) firstError = { type, message: err.message };
  console.error(`generateLink(${type}) failed: ${err.message} — trying the next type…`);
}
if (!data) {
  console.error(`generateLink failed for every type. First failure (${firstError?.type}): ${firstError?.message}`);
  process.exit(1);
}

const tokenHash = data?.properties?.hashed_token;
const otp = data?.properties?.email_otp;
console.log(`\nTarget : ${url} ${isProd ? '(PROD)' : '(local)'}`);
console.log(`User   : ${email}`);
// The link must carry the type its token was minted for; /auth/confirm falls
// back across the first-login slots anyway, but the right type verifies in one
// round trip.
console.log(`Link   : type=${linkType} (account ${confirmed ? 'confirmed' : 'never confirmed'})`);
if (otp) {
  console.log(`\n6-digit code (enter at the login screen after typing the e-mail):\n  ${otp}`);
}
// The app verifies token_hash statelessly via /auth/confirm (no PKCE cookie
// needed for an e-mailed link), then accepts pending invites and lands at /app.
if (tokenHash && appOrigin) {
  const link = `${appOrigin}/auth/confirm?token_hash=${tokenHash}&type=${linkType}&next=/app`;
  console.log(`\nOne-click login link (send this to the invitee):\n  ${link}`);
} else if (tokenHash) {
  console.log(
    `\ntoken_hash: ${tokenHash}\n  (pass the app origin as the 2nd arg, or set NEXT_PUBLIC_APP_URL,\n   to print a ready /auth/confirm?token_hash=…&type=${linkType}&next=/app link.)`
  );
}
console.log('');
