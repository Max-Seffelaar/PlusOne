// Local-dev helper — get the local stack ready for onboarding testing.
//
// Does three things, all idempotent:
//   1. Re-applies the onboarding migration's RPCs + reloads PostgREST. The local
//      Supabase stack is SHARED by every git worktree, so another branch's
//      `supabase db reset` silently drops this branch's functions — after which
//      "Venue aanmaken" fails with a generic error (PGRST202, no console error).
//      Re-running this fixes it without a disruptive reset.
//   2. Stamps a fixed TOTP secret on the MFA accounts (see below).
//   3. Mints a one-click magic-link login for a venue-less owner.
//
// Creating a venue makes you admin, and admin/finance MFA is mandatory (#20), so
// every fresh test account would otherwise force a brand-new TOTP enrollment. This
// script stamps ONE fixed, known TOTP secret on the MFA-mandatory seed users
// (admin@, finance@) — add that single secret to your authenticator ONCE and you
// can log straight into the rich seeded data without re-enrolling. It also creates
// a venue-less dev-owner@plusone.test and mints a one-click magic-link login for
// it; that owner is deliberately left WITHOUT a factor, so the onboarding flow
// shows the real MFA-enroll QR step at the end (the full first-run experience).
//
// LOCAL ONLY. It writes auth.* rows directly (plaintext secret validates because
// local GoTrue has no encryption key) and never runs against hosted. It does NOT
// touch seed.sql or the e2e suite (those clear factors and drive the real enroll
// flow), so tests are unaffected. Re-run after any `supabase db reset`.
//
//   pnpm dev:mfa                                   # base http://localhost:3000
//   pnpm dev:mfa http://localhost:55283            # pass your dev-server origin
//   pnpm dev:mfa http://localhost:55283 me@x.test  # custom owner email (fresh run)
//
// Creds come from .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// Then: add the printed secret to Google Authenticator / 1Password (manual entry)
// once, open the printed login URL, and verify MFA with the live code.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

const DB_CONTAINER = 'supabase_db_PlusOne_Guestlist';
const FIXED_SECRET = 'PLUSONELOCALADMINDEVSECRET234567';
const OWNER_EMAIL = process.argv[3] ?? process.env.DEV_OWNER_EMAIL ?? 'dev-owner@plusone.test';
const OWNER_FALLBACK_ID = 'cafe0000-0000-4000-8000-000000000001';
const APP_BASE = (process.argv[2] ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

// MFA-mandatory seed users (fixed UUIDs from supabase/seed.sql).
const SEED_MFA_IDS = [
  '11111111-1111-4111-8111-111111111111', // admin@plusone.test
  '33333333-3333-4333-8333-333333333333', // finance@plusone.test
];

// Read local creds from .env.local (falls back to process.env + local defaults).
function creds() {
  let env = {};
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
  const apiUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return { apiUrl, serviceKey };
}

// Run SQL via the local Postgres container, feeding it through stdin so the
// command line stays free of quoting. execSync goes through the shell, so a bare
// `docker` resolves on Windows too.
function runPsql(sql, extraFlags = '') {
  return execSync(
    `docker exec -i ${DB_CONTAINER} psql -U postgres -d postgres -X -v ON_ERROR_STOP=1 ${extraFlags}`,
    { input: sql, encoding: 'utf8' }
  );
}
const psql = (sql) => runPsql(sql, '-q');
const psqlValue = (sql) => runPsql(sql, '-tA').trim();

// TOTP (RFC 6238, SHA-1, 6 digits, 30s) — mirrors tests/e2e/helpers/totp.ts.
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
function totp(secret, atMs = Date.now()) {
  const key = base32Decode(secret);
  let counter = Math.floor(atMs / 1000 / 30);
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
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// Look up the owner by email, creating a venue-less user if absent. Returns its id.
function ensureOwner() {
  const existing = psqlValue(`select id from auth.users where email = '${OWNER_EMAIL}';`);
  if (existing) return existing;
  const id = OWNER_FALLBACK_ID;
  psql(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', '${id}', 'authenticated', 'authenticated',
      '${OWNER_EMAIL}', '', now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{"full_name":"Dev Owner"}'::jsonb,
      now(), now(), '', '', '', '', '', '', '', ''
    );
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    values (
      '${id}', '${id}',
      '{"sub":"${id}","email":"${OWNER_EMAIL}","email_verified":true}'::jsonb,
      'email', '${id}', now(), now(), now()
    );
  `);
  return id;
}

// Re-apply the onboarding migration (create-or-replace functions + grants) and
// reload PostgREST, so a shared-stack reset by another worktree can't leave the
// venue-creation RPC missing.
function ensureOnboardingRpcs() {
  try {
    const sql = readFileSync(
      new URL('../supabase/migrations/20260615000000_onboarding_venue_creation.sql', import.meta.url),
      'utf8'
    );
    psql(sql);
    psql(`notify pgrst, 'reload schema';`);
    console.log('• onboarding RPCs re-applied + PostgREST reloaded');
  } catch (e) {
    console.warn('• could not re-apply onboarding RPCs:', e.message);
  }
}

async function main() {
  const { apiUrl, serviceKey } = creds();
  if (!serviceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY (.env.local). Is the stack running + .env.local present?');
    process.exit(1);
  }

  ensureOnboardingRpcs();
  ensureOwner();
  // Stamp the fixed factor only on the rich-data seed accounts (admin/finance).
  // The venue-less owner is left factor-less ON PURPOSE so the onboarding flow
  // shows the real MFA-enroll QR step at the end.
  const targets = SEED_MFA_IDS.filter(
    (id) => psqlValue(`select 1 from auth.users where id = '${id}';`) === '1'
  );

  const ids = targets.map((id) => `'${id}'`).join(', ');
  const rows = targets
    .map((id) => `(gen_random_uuid(), '${id}', 'Dev Authenticator', 'totp', 'verified', now(), now(), '${FIXED_SECRET}')`)
    .join(',\n    ');
  psql(`
    delete from auth.mfa_factors where user_id in (${ids});
    insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
    values
    ${rows};
  `);

  const res = await fetch(`${apiUrl}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', email: OWNER_EMAIL }),
  });
  const link = await res.json();
  const loginUrl = link.hashed_token
    ? `${APP_BASE}/auth/confirm?token_hash=${link.hashed_token}&type=magiclink&next=/onboarding`
    : null;

  console.log('\n✅ Fixed-secret MFA on the rich-data accounts: admin@, finance@');
  console.log('   (log in as admin@ for the seeded venue/events — verify with the code below)');
  console.log('\n🔑 Add this secret to your authenticator ONCE (manual entry):');
  console.log(`   ${FIXED_SECRET}`);
  console.log(`   current code: ${totp(FIXED_SECRET)}  (rotates every 30s)`);
  if (loginUrl) {
    console.log(`\n🚪 One-click login as ${OWNER_EMAIL} (venue-less → onboarding):`);
    console.log('   (no factor — you scan the QR at the MFA step, the real flow)');
    console.log(`   ${loginUrl}`);
  } else {
    console.log('\n(Could not mint a magic link — check the service key. You can still log in via /login + Mailpit.)');
  }
  console.log(
    '\nTip: run after `supabase db reset`. The same secret works for every account,\nso your authenticator entry never changes.\n'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
