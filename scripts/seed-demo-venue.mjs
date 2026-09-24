// Store-review demo tenant (Fase 17 S3, 86ey6bfug): the "PLUSONE Demo" venue
// with fake data + the ONE demo user that /auth/review-login signs in.
// Runbook: docs/review-login.md. Max runs this by hand; it never runs in CI.
//
//   node scripts/seed-demo-venue.mjs            # local stack (.env.local)
//   node scripts/seed-demo-venue.mjs --prod     # required for any non-local URL
//   … --reset-members                            # remove stray demo-venue members
//
// Creds come from .env.local or process.env, like scripts/invite-link.mjs:
// NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. For prod, run it from
// the linked main checkout (whose .env.local points at prod) with --prod.
//
// IDEMPOTENT: fixed ids, insert-if-missing. A second run changes nothing except
// that the two demo events are moved forward again (starts_at/ends_at only), so
// the door always has upcoming events at submission time. Data a reviewer
// created or changed is left alone; reviewer-caused drift that would weaken the
// isolation (a membership outside the demo venue, the platform-admin flag) makes
// the script STOP instead of papering over it.
//
// It also RESETS the demo account's MFA: every TOTP factor is deleted, because a
// factor enrolled on the shared account would strand the next reviewer on the
// AAL2 wall (the route refuses such a session anyway).
//
// Why admin.createUser and not inviteUserByEmail (CLAUDE.md, invite mail rule):
// the demo address is on demo.plus-one.io, which has no MX record. An invite
// would send a mail that can only bounce (sender reputation) and whose link
// nobody can use; the account is only ever entered through review-login.
// email_confirm:true because a magic link for an unconfirmed account is not
// a normal sign-in path.
//
// Billing: the venue starts `trialing` like every new venue. Set it to `comped`
// with the documented SQL (docs/stripe-setup.md §5); the script prints it.
//
// Venue isolation (the route refuses otherwise): the demo user must be the
// ONLY member of the demo venue and there must be no open invite into it or to
// the demo address. Open invites are deleted (a pending invite to the demo
// address would be accepted at the reviewer's consent step). Other members make
// the script STOP with the list; pass --reset-members to remove them instead.
// At the end it prints how many live sessions the demo user has.
//
// Constants mirrored in src/features/auth/review-window.ts (guarded by
// review-login.test.ts): keep DEMO_REVIEW_EMAIL, DEMO_USER_ID, VENUE_ID
// (= DEMO_VENUE_ID), DEMO_VENUE_NAME and DEMO_ROLES identical. The demo user is created
// with exactly DEMO_USER_ID; the route and the /app layout key on it.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const DEMO_REVIEW_EMAIL = 'app-review@demo.plus-one.io';
const DEMO_USER_ID = 'de300000-0000-7000-8000-00000000a001';
const DEMO_VENUE_NAME = 'PLUSONE Demo';
// = DEMO_ROLES: review-login refuses any other role set on the demo membership.
const DEMO_ROLES = ['admin', 'doorhost'];
const RESET_MEMBERS = process.argv.includes('--reset-members');

// Fixed ids (UUIDv7-shaped, `de30` prefix = demo) so every run targets the same rows.
const VENUE_ID = 'de300000-0000-7000-8000-000000000001';
const EVENTS = [
  { id: 'de300000-0000-7000-8000-0000000000e1', name: 'Demo Night: Friday Session', slug: 'plusone-demo-friday', daysAhead: 1 },
  { id: 'de300000-0000-7000-8000-0000000000e2', name: 'Demo Night: Saturday Club', slug: 'plusone-demo-saturday', daysAhead: 8 },
];
// Last UUID group = 2-char kind + event number + 9-digit row number.
const demoId = (kind, e, n) => `de300000-0000-7000-8000-${kind}${e}${String(n).padStart(9, '0')}`;
const tierId = (e, n) => demoId('a0', e, n);
const guestId = (e, n) => demoId('b0', e, n);
const requestId = (e, n) => demoId('c0', e, n);

// Fictional names only (no real people, no real contact details).
const FIRST = ['Alex', 'Sam', 'Robin', 'Jamie', 'Noor', 'Kai', 'Lou', 'Mika', 'Jesse', 'Sky', 'Remi', 'Charlie'];
const LAST = ['Demoer', 'Testveld', 'Voorbeeld', 'Proefstra', 'Fictief', 'Sampleman'];

// ── env ────────────────────────────────────────────────────────────────────
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
    anonKey: get('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  };
}

function fail(message) {
  console.error(`[seed-demo-venue] ${message}`);
  process.exit(1);
}

const { url, serviceKey, anonKey } = env();
if (!url || !serviceKey) fail('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (.env.local or env).');
const host = new URL(url).hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1';
if (!isLocal && !process.argv.includes('--prod')) {
  fail(`Target ${host} is not local. Re-run with --prod if you really mean that project.`);
}
if (process.env.CI) fail('Refusing to run in CI. This script is run by hand only.');
console.log(`[seed-demo-venue] target: ${host}`);

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) {
    // 23505 = unique violation on a key other than the id (a real venue/event
    // already owns the slug): name it instead of a raw constraint message.
    if (error.code === '23505') {
      fail(`${label}: a slug or other unique value is already taken by a row that is not the demo row (${error.message}). Pick another slug in this script.`);
    }
    fail(`${label}: ${error.message}`);
  }
  return data;
}

// Insert rows whose id does not exist yet; existing rows are left untouched.
async function insertMissing(table, rows) {
  await must(`${table} insert`, db.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
}

// ── 1. demo user ───────────────────────────────────────────────────────────
// One admin request with ?filter= (same as scripts/invite-link.mjs), then an
// exact, case-insensitive match on the result.
async function findUser(email) {
  const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=50&filter=${encodeURIComponent(email)}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) fail(`user lookup: HTTP ${res.status}`);
  const body = await res.json();
  const users = Array.isArray(body?.users) ? body.users : [];
  return users.find((u) => (u.email ?? '').toLowerCase() === email) ?? null;
}

let user = await findUser(DEMO_REVIEW_EMAIL);
if (!user) {
  // The id may exist with a rebound e-mail (profile-actions refuses that now,
  // but an older change would show up here): never create a second account.
  const byId = await db.auth.admin.getUserById(DEMO_USER_ID);
  if (byId.data?.user) {
    fail(`User ${DEMO_USER_ID} exists but no longer has the demo e-mail. Investigate and restore it by hand; review-login refuses it until then.`);
  }
  const created = await must(
    'createUser',
    db.auth.admin.createUser({
      id: DEMO_USER_ID,
      email: DEMO_REVIEW_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: 'App Reviewer' },
    }),
  );
  user = created.user;
  console.log('[seed-demo-venue] created demo user');
} else if (user.id !== DEMO_USER_ID) {
  fail(
    `${DEMO_REVIEW_EMAIL} exists with id ${user.id}, not the fixed ${DEMO_USER_ID}. ` +
      'Delete that account by hand (it has no business data) and re-run; review-login and the /app layout key on the fixed id.',
  );
} else if (!user.email_confirmed_at) {
  await must('confirm demo user', db.auth.admin.updateUserById(user.id, { email_confirm: true }));
}
const userId = user.id;

const factors = await must('listFactors', db.auth.admin.mfa.listFactors({ userId }));
for (const factor of factors.factors ?? []) {
  await must('deleteFactor', db.auth.admin.mfa.deleteFactor({ userId, id: factor.id }));
  console.log('[seed-demo-venue] removed an MFA factor from the demo user');
}

await must(
  'user_profiles upsert',
  db.from('user_profiles').upsert(
    { id: userId, email: DEMO_REVIEW_EMAIL, full_name: 'App Reviewer', first_name: 'App', last_name: 'Reviewer' },
    { onConflict: 'id', ignoreDuplicates: true },
  ),
);
const profile = await must('user_profiles read', db.from('user_profiles').select('is_platform_admin').eq('id', userId).single());
if (profile.is_platform_admin) fail('The demo user is a platform admin. Revoke that first (set_platform_admin); it must never be one.');
// No MFA nudge on the shared admin account, ever: a reviewer who follows it
// would enrol a factor that locks every later reviewer out (guards.ts treats
// 'infinity' as snoozed for good). Restored on every run.
await must('mfa snooze', db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', userId));

// ── 2. venue + subscription + membership ───────────────────────────────────
await insertMissing('venues', [
  {
    id: VENUE_ID,
    name: DEMO_VENUE_NAME,
    slug: 'plusone-demo',
    retention_months: 12,
    city: 'Amsterdam',
    country: 'NL',
    company_name: 'PlusOne Demo',
    default_personal_quota: 5,
    settings: { venue_type: 'club', onboarding: { completed: true, created_by: userId } },
  },
]);
const venue = await must('venue read', db.from('venues').select('name').eq('id', VENUE_ID).single());
if (venue.name !== DEMO_VENUE_NAME) {
  console.warn(`[seed-demo-venue] demo venue was renamed; restoring "${DEMO_VENUE_NAME}"`);
  await must('venue rename', db.from('venues').update({ name: DEMO_VENUE_NAME }).eq('id', VENUE_ID));
}

const existingSub = await must('subscription read', db.from('subscriptions').select('status').eq('venue_id', VENUE_ID).maybeSingle());
if (!existingSub) {
  await must(
    'subscription insert',
    db.from('subscriptions').insert({
      venue_id: VENUE_ID,
      status: 'trialing',
      plan_id: 'basic',
      current_period_end: new Date(Date.now() + 14 * 86400000).toISOString(),
    }),
  );
}

const memberships = await must('memberships read', db.from('venue_memberships').select('venue_id').eq('user_id', userId));
const elsewhere = memberships.filter((m) => m.venue_id !== VENUE_ID).map((m) => m.venue_id);
if (elsewhere.length > 0) {
  fail(
    `The demo user is a member of other venue(s): ${elsewhere.join(', ')}. ` +
      'Investigate (a reviewer created a venue, or someone invited the demo address) and remove those memberships by hand. ' +
      'review-login refuses to sign in until the demo venue is the only one.',
  );
}
// Roles: admin sees and decides approvals (approve_* RPCs require admin) and
// gets the approvals push; doorhost makes the Check-in tab the reviewer's
// door view. Upsert so a reviewer-edited role set is restored.
await must(
  'membership upsert',
  db
    .from('venue_memberships')
    .upsert({ venue_id: VENUE_ID, user_id: userId, roles: DEMO_ROLES, job_title: 'App review' }, { onConflict: 'venue_id,user_id' }),
);

// Venue isolation. Other members: stop with the list, or remove them with
// --reset-members. Open invites into the demo venue or to the demo address:
// always deleted (nothing legitimate ever invites into the demo tenant).
const venueMembers = await must('venue members read', db.from('venue_memberships').select('user_id, roles').eq('venue_id', VENUE_ID));
const strays = venueMembers.filter((m) => m.user_id !== userId);
if (strays.length > 0) {
  const list = strays.map((m) => `${m.user_id} (${(m.roles ?? []).join(',')})`).join(', ');
  if (!RESET_MEMBERS) {
    fail(
      `The demo venue has other members: ${list}. A code holder (admin) may have invited them. ` +
        'Investigate, then re-run with --reset-members to remove them. review-login refuses to sign in until the demo user is the only member.',
    );
  }
  for (const m of strays) {
    await must('stray member delete', db.from('venue_memberships').delete().eq('venue_id', VENUE_ID).eq('user_id', m.user_id));
  }
  console.warn(`[seed-demo-venue] removed ${strays.length} stray demo-venue member(s): ${list}`);
}

const openVenueInvites = await must('venue invites read', db.from('invites').select('id').eq('venue_id', VENUE_ID).is('accepted_at', null));
const openAddressedInvites = await must('addressed invites read', db.from('invites').select('id, venue_id').ilike('email', DEMO_REVIEW_EMAIL).is('accepted_at', null));
const inviteIds = [...new Set([...openVenueInvites, ...openAddressedInvites].map((i) => i.id))];
if (inviteIds.length > 0) {
  await must('open invites delete', db.from('invites').delete().in('id', inviteIds));
  console.warn(`[seed-demo-venue] deleted ${inviteIds.length} open invite(s) into the demo venue or to the demo address`);
}

// ── 3. events, tiers, guests, requests ─────────────────────────────────────
function eventWindow(daysAhead) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + daysAhead);
  start.setUTCHours(21, 0, 0, 0); // 23:00 Amsterdam in summer, 22:00 in winter
  const end = new Date(start.getTime() + 6 * 3600000); // crosses midnight (#26)
  return { starts_at: start.toISOString(), ends_at: end.toISOString() };
}

for (const [e, event] of EVENTS.entries()) {
  const window = eventWindow(event.daysAhead);
  await insertMissing('events', [
    {
      id: event.id,
      venue_id: VENUE_ID,
      name: event.name,
      landing_slug: event.slug,
      landing_active: true,
      status: 'open',
      default_member_quota: 5,
      ...window,
    },
  ]);
  // Keep the demo events upcoming on every run; dates only, never the status
  // (a reviewer may have closed one, and closed → open is not a valid move).
  await must('event dates', db.from('events').update(window).eq('id', event.id));

  const regular = tierId(e + 1, 1);
  const vip = tierId(e + 1, 2);
  await insertMissing('guest_tiers', [
    { id: regular, event_id: event.id, venue_id: VENUE_ID, name: 'Regular', color: '#8A8A93', aliases: [] },
    { id: vip, event_id: event.id, venue_id: VENUE_ID, name: 'VIP', color: '#B5A6FF', aliases: ['vip'] },
  ]);

  const guestCount = e === 0 ? 24 : 10;
  const guests = Array.from({ length: guestCount }, (_, i) => ({
    id: guestId(e + 1, i + 1),
    event_id: event.id,
    venue_id: VENUE_ID,
    tier_id: i % 5 === 0 ? vip : regular,
    full_name: `${FIRST[i % FIRST.length]} ${LAST[(i + e) % LAST.length]}`,
    plus_ones: i % 4 === 1 ? 1 : 0,
    note: i === 0 ? 'Birthday, table near the booth' : null,
    note_priority: i === 0 ? 'high' : 'none',
    added_by: userId,
    source: 'app',
    status: 'approved',
  }));
  await insertMissing('guests', guests);

  if (e === 0) {
    // Open landing-page requests, so the approvals screen has work to do.
    await insertMissing('guest_requests', [
      { id: requestId(1, 1), event_id: event.id, venue_id: VENUE_ID, full_name: 'Robin Voorbeeld', email: 'robin@example.com', plus_ones: 1, motivation: 'Friends with the DJ' },
      { id: requestId(1, 2), event_id: event.id, venue_id: VENUE_ID, full_name: 'Sky Proefstra', plus_ones: 0 },
      { id: requestId(1, 3), event_id: event.id, venue_id: VENUE_ID, full_name: 'Mika Testveld', email: 'mika@example.com', plus_ones: 2, motivation: 'Birthday celebration' },
    ]);
  }
}

// ── 4. report ──────────────────────────────────────────────────────────────
const sub = await must('subscription read', db.from('subscriptions').select('status').eq('venue_id', VENUE_ID).single());
console.log(`[seed-demo-venue] done. venue ${VENUE_ID} ("${DEMO_VENUE_NAME}"), subscription: ${sub.status}`);
if (sub.status !== 'comped') {
  console.log(
    '[seed-demo-venue] NEXT: set the demo venue to comped (docs/stripe-setup.md §5), as table owner:\n' +
      `  update public.subscriptions set status = 'comped', updated_at = now() where venue_id = '${VENUE_ID}';`,
  );
}

// ── 5. live demo sessions (report only) ────────────────────────────────────
// auth.sessions is not reachable through PostgREST, and the session list RPC
// (admin_list_user_sessions) runs as a venue admin, not as the service role. So
// sign in as the demo user on a throwaway in-memory client, ask, and revoke that
// probe session again. Every review login already revokes the others.
if (!anonKey) {
  console.log('[seed-demo-venue] live sessions: skipped (NEXT_PUBLIC_SUPABASE_ANON_KEY not set)');
} else {
  const link = await must('probe link', db.auth.admin.generateLink({ type: 'magiclink', email: DEMO_REVIEW_EMAIL }));
  const probe = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const verified = await must('probe verify', probe.auth.verifyOtp({ type: 'magiclink', token_hash: link.properties.hashed_token }));
  const probeSessionId = JSON.parse(Buffer.from(verified.session.access_token.split('.')[1], 'base64url').toString()).session_id;
  const sessions = await must('session list', probe.rpc('admin_list_user_sessions', { p_target: userId }));
  await probe.auth.signOut({ scope: 'local' });
  const live = sessions.filter((row) => row.session_id !== probeSessionId).length;
  console.log(`[seed-demo-venue] live demo sessions (excluding this script's probe): ${live}`);
}
