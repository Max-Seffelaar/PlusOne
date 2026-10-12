/**
 * Snelheid P2 (z8uq9m2xz2, 9-FE) — one synthetic "old venue" for the before/after
 * measurements of the front-end PRs, LOCAL STACK ONLY.
 *
 *   venue "Perf 300 events"  fe000000-0000-7000-8000-00000000a300
 *   300 events   240 in the past (one a day), 60 upcoming
 *   3 000 guests 10 per event, linked to the first 1 000 contacts (3 events each)
 *   3 000 contacts, 300 of them starred (Regulars)
 *   300 request links (one per event: past ~205 the old `.in(linkIds)` 414s)
 *   600 requests  per event one pending + one denied
 *
 * admin@plusone.test is admin there, so the dev-login link shows it under
 * More → Switch company. Idempotent: a second run skips what already exists.
 * Soft-delete only (CLAUDE.md): there is no teardown; `pnpm db:fresh` purges.
 *
 * Usage (credentials from .env.local, which `pnpm dev` writes for the local stack):
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *
 * Also exports `adminUserClient()` — a supabase-js client signed in as
 * admin@plusone.test (magic link minted + verified server-side, as dev-login
 * does), so the measure scripts read through RLS like the app does.
 */
import { createClient } from '@supabase/supabase-js';
import { fileURLToPath } from 'node:url';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const PERF_VENUE = 'fe000000-0000-7000-8000-00000000a300';
export const ADMIN_EMAIL = 'admin@plusone.test';
const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';
const EVENTS = 300;
const PAST = 240;
const GUESTS_PER_EVENT = 10;
const CONTACTS = 3000;
const LINKED_CONTACTS = 1000;
const STARRED_EVERY = 10;

const hex12 = (prefix, n) => `${prefix}${n.toString(16).padStart(12 - prefix.length, '0')}`;
const eventId = (e) => `fe0a3000-0000-7000-8000-${hex12('e', e)}`;
const tierId = (e) => `fe0a3000-0000-7000-8000-${hex12('d', e)}`;
const linkId = (e) => `fe0a3000-0000-7000-8000-${hex12('b', e)}`;
const contactId = (c) => `fe0a3000-0000-7000-8000-${hex12('c', c)}`;
const requestId = (e, k) => `fe0a3000-0000-7000-8000-${hex12('f', e * 2 + k)}`;
const guestId = (e, i) => `fe0a3000-0000-7000-8000-${hex12('a', e * GUESTS_PER_EVENT + i)}`;

function assertLocal() {
  if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) {
    throw new Error(`p2-seed refuses a non-local Supabase URL (${SUPABASE_URL}) — local stack only.`);
  }
  if (!SERVICE_ROLE_KEY || !ANON_KEY) throw new Error('missing Supabase keys — run with node --env-file=.env.local');
}

export function serviceClient() {
  assertLocal();
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

export async function adminUserClient() {
  const admin = serviceClient();
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email: ADMIN_EMAIL });
  if (error) throw error;
  const user = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error: vErr } = await user.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
  if (vErr) throw vErr;
  return user;
}

async function insertBatched(admin, table, rows, size = 500) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await admin.from(table).upsert(rows.slice(i, i + size), { onConflict: 'id', ignoreDuplicates: true });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function seed() {
  const admin = serviceClient();
  const { error: vErr } = await admin
    .from('venues')
    .upsert({ id: PERF_VENUE, name: 'Perf 300 events', slug: 'perf-300-events' }, { onConflict: 'id' });
  if (vErr) throw new Error(`venue: ${vErr.message}`);
  const { error: mErr } = await admin
    .from('venue_memberships')
    .upsert({ venue_id: PERF_VENUE, user_id: ADMIN_USER_ID, roles: ['admin'] }, { onConflict: 'venue_id,user_id' });
  if (mErr) throw new Error(`membership: ${mErr.message}`);

  // Requests are written last, so a full set means a finished earlier run.
  const { count } = await admin.from('guest_requests').select('id', { count: 'exact', head: true }).eq('venue_id', PERF_VENUE);
  if ((count ?? 0) >= EVENTS * 2) {
    console.log(`[p2-seed] "Perf 300 events" is already seeded — nothing to do.`);
    return;
  }

  const day = 24 * 60 * 60 * 1000;
  const today22 = new Date();
  today22.setHours(22, 0, 0, 0);
  const events = Array.from({ length: EVENTS }, (_, e) => {
    const start = new Date(today22.getTime() + (e - PAST) * day + (e < PAST ? 0 : day));
    return {
      id: eventId(e),
      venue_id: PERF_VENUE,
      name: `Perf night ${String(e + 1).padStart(3, '0')}`,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + 6 * 60 * 60 * 1000).toISOString(),
      status: e < PAST ? 'closed' : 'open',
      landing_slug: `perf-300-${e}`,
      landing_active: false,
    };
  });
  await insertBatched(admin, 'events', events, 100);
  await insertBatched(admin, 'guest_tiers', events.map((ev, e) => ({
    id: tierId(e), event_id: ev.id, name: 'Regular', color: '#8A8A93', aliases: [],
  })));

  await insertBatched(admin, 'contacts', Array.from({ length: CONTACTS }, (_, c) => ({
    id: contactId(c),
    venue_id: PERF_VENUE,
    full_name: `Perf Contact ${String(c).padStart(4, '0')}`,
    is_permanent: c % STARRED_EVERY === 0,
    source: 'import',
    created_by: ADMIN_USER_ID,
  })));

  const guests = [];
  for (let e = 0; e < EVENTS; e++) {
    for (let i = 0; i < GUESTS_PER_EVENT; i++) {
      const c = (e * GUESTS_PER_EVENT + i) % LINKED_CONTACTS;
      guests.push({
        id: guestId(e, i), event_id: events[e].id, tier_id: tierId(e),
        full_name: `Perf Contact ${String(c).padStart(4, '0')}`, contact_id: contactId(c),
        plus_ones: i % 3, added_by: ADMIN_USER_ID, source: 'app', status: 'approved',
      });
    }
  }
  await insertBatched(admin, 'guests', guests);

  await insertBatched(admin, 'request_links', events.map((ev, e) => ({
    id: linkId(e), event_id: ev.id, venue_id: PERF_VENUE, slug: `perf-300-link-${e}`,
    label: `Promoter ${(e % 12) + 1}`, created_by: ADMIN_USER_ID,
  })));

  const requests = [];
  events.forEach((ev, e) => {
    ['pending', 'denied'].forEach((status, k) => {
      requests.push({
        id: requestId(e, k), event_id: ev.id, venue_id: PERF_VENUE, request_link_id: linkId(e),
        full_name: `Perf Requester ${e}-${status}`, email: `perf-${e}-${status}@example.test`,
        plus_ones: 1, motivation: 'perf seed', status,
        ...(status === 'denied' ? { decided_by: ADMIN_USER_ID, decided_at: ev.starts_at, decision_message: 'Full tonight.' } : {}),
      });
    });
  });
  await insertBatched(admin, 'guest_requests', requests, 200);

  console.log(`[p2-seed] seeded "Perf 300 events": ${EVENTS} events (${PAST} past), ${guests.length} guests, ` +
    `${CONTACTS} contacts (${CONTACTS / STARRED_EVERY} starred), ${EVENTS} request links, ${requests.length} requests.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  seed().catch((err) => {
    console.error(`[p2-seed] FAILED: ${err.message ?? err}`);
    process.exit(1);
  });
}
