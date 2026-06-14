// Local dev login helper — prints a fresh e-mail OTP (minted via the GoTrue
// admin API) and the current TOTP/MFA code for the seeded accounts, so local
// login needs no Inbucket lookup and no phone authenticator.
//
// LOCAL ONLY: it reads the local service-role key from `supabase status` and
// mints a one-time OTP for an EXISTING seed user — the same server-side admin
// pattern as tests/e2e/helpers/supabase-admin.ts, never shipped to the browser.
// The TOTP secret matches the verified factor seeded in supabase/seed.sql. None
// of this is meaningful against a real Supabase project. See docs/auth-setup.md §9.
//
//   pnpm dev:code            # admin@plusone.test  (full admin, both venues)
//   pnpm dev:code finance    # finance@plusone.test
//   pnpm dev:code staff      # staff@plusone.test  (no MFA)

import { execSync } from 'node:child_process';
import crypto from 'node:crypto';

// Matches the verified factor seeded in supabase/seed.sql (admin + finance share it).
const TOTP_SECRET = 'PLUSONELOCALADMINDEVSECRET234567';
const MFA_ROLES = new Set(['admin', 'finance']);

const arg = (process.argv[2] || 'admin').trim();
const email = arg.includes('@') ? arg : `${arg}@plusone.test`;
const role = email.split('@')[0];

// Dependency-free TOTP (RFC 6238, SHA-1, 6 digits, 30s step) — GoTrue defaults.
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function totp(secret, atMs = Date.now(), step = 30, digits = 6) {
  const key = base32Decode(secret);
  let counter = Math.floor(atMs / 1000 / step);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

function localEnv() {
  let raw;
  try {
    raw = execSync('supabase status -o env', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    console.error('Could not read `supabase status`. Is the local stack running? → pnpm supabase:start');
    process.exit(1);
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return env;
}

const env = localEnv();
const API = env.API_URL;
const SVC = env.SERVICE_ROLE_KEY;
if (!API || !SVC) {
  console.error('Missing API_URL / SERVICE_ROLE_KEY from `supabase status`.');
  process.exit(1);
}

const res = await fetch(`${API}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', email }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.email_otp) {
  console.error(`generate_link failed for ${email}: ${body.msg || JSON.stringify(body)}`);
  console.error('Is this a seeded account? Run `pnpm db:reset` to (re)create the seed users.');
  process.exit(1);
}

const now = Date.now();
const code = totp(TOTP_SECRET, now);
const secondsLeft = 30 - Math.floor((now / 1000) % 30);
const needsMfa = MFA_ROLES.has(role);

console.log('');
console.log('  PLUSONE — local login (development only)');
console.log('  ----------------------------------------');
console.log(`  E-mail      : ${email}`);
console.log(`  E-mail code : ${body.email_otp}   (single-use — rerun for a fresh one)`);
console.log(
  needsMfa
    ? `  MFA code    : ${code}   (valid ~${secondsLeft}s — enter at /mfa/verify)`
    : '  MFA code    : — (this role needs no MFA)'
);
console.log('');
