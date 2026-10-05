// Store-screenshot demo data (ClickUp 86ey6bf8k, Fase 17 M4) — LOCAL STACK ONLY.
//
// Layers a lively, PII-free demo night on top of supabase/seed.sql so the store
// screenshots (`pnpm store:screenshots`, tests/e2e/store/) show a venue that is
// actually in use. seed.sql itself is never edited: pgTAP relies on it exactly.
//
// What it writes (fixed ids, so a re-run is idempotent and never duplicates):
//   * a demo venue admin, store-demo@plusone.test ("Alex Morgan"). The shots log
//     in as this user rather than admin@: `pnpm dev:mfa` makes admin@ a PLATFORM
//     admin, and that user's nav then carries the internal Platform entry, which
//     never belongs in a store listing. A plain venue admin sees exactly what a
//     customer sees.
//   * "Neon Nights" at Club Vesper, LIVE right now (started 90 min ago), with 60
//     guests across Guest/VIP/Artist tiers, +N plus-ones, 26 check-ins spread
//     over the night, one refusal at the door, two pending landing guests, three
//     open guest requests and one open quota request.
//   * two upcoming events and one past event with a few guests, so Home and the
//     Events list are not a single card.
//   * an English, alcohol-free touch-up of the seed rows that would otherwise be
//     visible: the seed event "PLUSONE Launch Night" becomes "Launch Night",
//     the seed tier "VIP + fles op tafel" (and its fles/champagne aliases)
//     becomes "Artist", and the Dutch note/motivation/reason strings become
//     English. Only on this throwaway stack — seed.sql is untouched.
//     Append-only rows (check_ins, refusals: UPDATE is revoked even from
//     service_role) are never touched up — they are inserted right, once.
//
// Writes go through the service role (RLS bypassed, as in seed.sql), so every
// trigger still fires: quota/capacity/tier caps, audit_log, scope derivation,
// check-in → guest status sync. Nothing is hard-deleted (CLAUDE.md, #21).
//
// HARD-GATED to a localhost Supabase URL — same rule and same hostname-equality
// check as src/app/auth/dev-login/route.ts. There is no staging: the only
// non-local project is prod, and this script must never be able to touch it.
//
//   node scripts/store-screenshot-seed.mjs     (run by `pnpm store:screenshots`)

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// ── env + hard gate ──────────────────────────────────────────────────────────

function loadEnvLocal() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch {
    // No .env.local — the shell must export the vars.
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

/** Exported for the unit guard: true only for a localhost / 127.0.0.1 hostname. */
export function isLocalSupabaseUrl(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

// ── fixed ids ────────────────────────────────────────────────────────────────

export const STORE_DEMO = {
  email: 'store-demo@plusone.test',
  userId: '5d000000-0000-4000-8000-000000000001',
  fullName: 'Alex Morgan',
  venueId: 'aa000000-0000-7000-8000-000000000001', // Club Vesper (seed.sql)
  liveEventId: '5e000000-0000-7000-8000-000000000001',
};

const SEED = {
  event: 'ee000000-0000-7000-8000-000000000001',
  tierBottle: 'dd000000-0000-7000-8000-000000000003',
  max: '11111111-1111-4111-8111-111111111111',
  tom: '55555555-5555-4555-8555-555555555555', // staff, venue quota 10
  lisa: '66666666-6666-4666-8666-666666666666', // doorhost, venue quota 5
};

const id = (block, n) => `5${block}000000-0000-7000-8000-${String(n).padStart(12, '0')}`;

// ── demo content (fictional, PII-free: no e-mail, no phone) ──────────────────

const FIRST = [
  'Noah', 'Emma', 'Liam', 'Olivia', 'Lucas', 'Mia', 'Elias', 'Zoë', 'Milan', 'Sofia',
  'Adam', 'Lina', 'Jonah', 'Amira', 'Felix', 'Nora', 'Omar', 'Julia', 'Hugo', 'Ines',
];
const LAST = [
  'Carter', 'Lindqvist', 'Moreau', 'Okafor', 'Rossi', 'Novak', 'Haddad', 'Jansen',
  'Silva', 'Becker', 'Larsen', 'Dubois', 'Kaya', 'Murphy', 'Weber', 'Costa',
];
/** Deterministic, collision-free name for guest #i. */
const nameFor = (i, offset = 0) => `${FIRST[(i + offset) % FIRST.length]} ${LAST[(i * 7 + offset) % LAST.length]}`;

const LIVE_GUESTS = 60;
const PLUS = [0, 1, 0, 2, 0, 0, 1, 0, 3, 0, 1, 0];

// ── helpers ──────────────────────────────────────────────────────────────────

function must(label, { error }) {
  if (error) throw new Error(`store seed: ${label} failed: ${error.message}`);
}

const minutes = (m) => new Date(Date.now() + m * 60_000).toISOString();

async function ensureDemoUser(db) {
  const { error } = await db.auth.admin.createUser({
    id: STORE_DEMO.userId,
    email: STORE_DEMO.email,
    email_confirm: true,
    user_metadata: { full_name: STORE_DEMO.fullName },
  });
  if (error && !/already|exists|registered/i.test(error.message)) {
    throw new Error(`store seed: creating ${STORE_DEMO.email} failed: ${error.message}`);
  }
  const [first, ...rest] = STORE_DEMO.fullName.split(' ');
  must(
    'demo profile',
    await db.from('user_profiles').upsert(
      { id: STORE_DEMO.userId, full_name: STORE_DEMO.fullName, email: STORE_DEMO.email, first_name: first, last_name: rest.join(' ') },
      { onConflict: 'id' },
    ),
  );
  const { data: member, error: readErr } = await db
    .from('venue_memberships')
    .select('id')
    .eq('venue_id', STORE_DEMO.venueId)
    .eq('user_id', STORE_DEMO.userId)
    .maybeSingle();
  if (readErr) throw new Error(`store seed: reading the demo membership failed: ${readErr.message}`);
  if (!member) {
    must(
      'demo membership',
      await db
        .from('venue_memberships')
        .insert({ venue_id: STORE_DEMO.venueId, user_id: STORE_DEMO.userId, roles: ['admin'], job_title: 'Venue manager' }),
    );
  }
}

/** seed.sql rows that would otherwise show up in a shot: English, no alcohol. */
async function touchUpSeed(db) {
  // The seed event is an upcoming card on the demo admin's Home; its all-caps
  // brand prefix reads as noise in a store shot. Name only — landing_slug and
  // status stay, so no slug/link/status trigger fires (audit still records it).
  must('seed event name', await db.from('events').update({ name: 'Launch Night' }).eq('id', SEED.event));
  must(
    'seed tier rename',
    await db
      .from('guest_tiers')
      .update({ name: 'Artist', description: null, aliases: ['artist'] })
      .eq('id', SEED.tierBottle),
  );
  must(
    'seed guest note',
    await db.from('guests').update({ note: 'Reserve the booth next to the DJ' }).eq('id', 'cc000000-0000-7000-8000-000000000001'),
  );
  must(
    'seed request motivation',
    await db.from('guest_requests').update({ motivation: 'Friends of the DJ' }).eq('id', 'bb000000-0000-7000-8000-000000000001'),
  );
  must(
    'seed request reason',
    await db.from('guest_requests').update({ decision_reason: 'List is full tonight' }).eq('id', 'bb000000-0000-7000-8000-000000000003'),
  );
  // No refusal touch-up here: refusals (like check_ins) are append-only — UPDATE
  // is revoked even from service_role (full_schema migration). The seed refusal
  // sits on the seed event, which no shot shows; the live night carries its own
  // refusal, with an English reason set at INSERT (seedLiveNight).
}

async function upsertEvent(db, { eventId, name, slug, startMin, hours, capacity }) {
  // Times are refreshed on every run, so a re-run hours later still has a LIVE
  // night (the phase is time-derived, event-phase.ts).
  must(
    `event ${name}`,
    await db.from('events').upsert(
      {
        id: eventId,
        venue_id: STORE_DEMO.venueId,
        name,
        starts_at: minutes(startMin),
        ends_at: minutes(startMin + hours * 60),
        status: 'open',
        landing_slug: slug,
        landing_active: true,
        capacity,
        default_member_quota: 5,
      },
      { onConflict: 'id' },
    ),
  );
}

async function upsertTiers(db, eventId, block) {
  const tiers = [
    { id: id(block, 11), name: 'Guest', color: '#8A8A93', aliases: [] },
    { id: id(block, 12), name: 'VIP', color: '#B5A6FF', aliases: ['vip'] },
    { id: id(block, 13), name: 'Artist', color: '#7FD1B9', aliases: ['artist'] },
  ];
  must(
    'tiers',
    await db
      .from('guest_tiers')
      .upsert(tiers.map((t) => ({ ...t, event_id: eventId, venue_id: STORE_DEMO.venueId })), { onConflict: 'id', ignoreDuplicates: true }),
  );
  return { guest: tiers[0].id, vip: tiers[1].id, artist: tiers[2].id };
}

/** A short list of approved guests, added by the demo admin (quota-exempt). */
async function simpleGuests(db, eventId, tiers, block, count, offset) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: id(block, 100 + i),
    event_id: eventId,
    venue_id: STORE_DEMO.venueId,
    tier_id: i % 4 === 0 ? tiers.vip : tiers.guest,
    full_name: nameFor(i, offset),
    plus_ones: PLUS[i % PLUS.length],
    added_by: STORE_DEMO.userId,
    source: 'app',
    status: 'approved',
  }));
  must('guests', await db.from('guests').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
  return rows;
}

async function checkIn(db, eventId, guests, { firstMin, spacingMin, block }) {
  const rows = guests.map((g, i) => {
    const at = minutes(firstMin + i * spacingMin);
    return {
      id: id(block, 500 + i),
      guest_id: g.id,
      event_id: eventId,
      venue_id: STORE_DEMO.venueId,
      checked_by: SEED.lisa,
      checked_at: at,
      client_timestamp: at,
      device_id: 'door-ipad-01',
      // A few groups are still waiting on part of their party.
      plus_ones_arrived: i % 5 === 3 ? Math.max(0, g.plus_ones - 1) : g.plus_ones,
      offline_synced: false,
    };
  });
  // Insert-only (ON CONFLICT DO NOTHING): a merge upsert is ON CONFLICT DO
  // UPDATE, which needs the UPDATE grant service_role does not hold on
  // check_ins. A re-run keeps the first run's check-in times; for fresh times,
  // reset the stack first (the CI workflow always starts from a fresh stack).
  must('check-ins', await db.from('check_ins').upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
}

// ── the live night ───────────────────────────────────────────────────────────

async function seedLiveNight(db) {
  const eventId = STORE_DEMO.liveEventId;
  await upsertEvent(db, { eventId, name: 'Neon Nights', slug: 'neon-nights-demo', startMin: -90, hours: 6, capacity: 250 });
  const tiers = await upsertTiers(db, eventId, 'e');

  const guests = Array.from({ length: LIVE_GUESTS }, (_, i) => {
    // Staff + doorhost adds stay well inside their personal quota (Tom 10,
    // Lisa 5 — seed.sql); everyone else is added by the quota-exempt admin.
    const addedBy = i < 4 ? SEED.tom : i < 6 ? SEED.lisa : STORE_DEMO.userId;
    // Staff/door adds bring no plus-ones: 1 slot each, whichever default applies.
    const plus = addedBy === STORE_DEMO.userId ? PLUS[i % PLUS.length] : 0;
    const pending = i === 57 || i === 58;
    return {
      id: id('e', 100 + i),
      event_id: eventId,
      venue_id: STORE_DEMO.venueId,
      tier_id: i % 6 === 5 ? tiers.artist : i % 4 === 1 ? tiers.vip : tiers.guest,
      full_name: nameFor(i),
      plus_ones: plus,
      note: i === 7 ? 'Birthday group, keep them together' : i === 13 ? 'Tour manager, needs backstage access' : null,
      note_priority: i === 7 || i === 13 ? 'high' : 'none',
      added_by: addedBy,
      source: pending ? 'landing' : 'app',
      status: pending ? 'pending' : 'approved',
    };
  });
  must('live guests', await db.from('guests').upsert(guests, { onConflict: 'id', ignoreDuplicates: true }));

  // 26 arrivals between doors and now, roughly every 3 minutes.
  const arrived = guests.filter((g, i) => g.status === 'approved' && i % 9 !== 4).slice(0, 26);
  await checkIn(db, eventId, arrived, { firstMin: -85, spacingMin: 3, block: 'e' });

  // One guest turned away at the door. The reason is set on INSERT — refusals
  // are append-only (no UPDATE grant for any role), and insert-only on conflict
  // keeps a re-run idempotent. Guest #22 is approved and not among the arrivals
  // (i % 9 === 4); the refusal trigger mirrors guests.status → refused.
  const refusedAt = minutes(-40);
  must(
    'refusal',
    await db.from('refusals').upsert(
      {
        id: id('e', 700),
        guest_id: id('e', 122),
        event_id: eventId,
        venue_id: STORE_DEMO.venueId,
        refused_by: SEED.lisa,
        reason: 'Dress code',
        refused_at: refusedAt,
        client_timestamp: refusedAt,
        device_id: 'door-ipad-01',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    ),
  );

  const requests = [
    { n: 1, full_name: 'Maya Lindgren', plus_ones: 1, motivation: 'Friends of the headliner' },
    { n: 2, full_name: 'Theo Marchetti', plus_ones: 0, motivation: 'Photographer for the night' },
    { n: 3, full_name: 'Sara Okonkwo', plus_ones: 2, motivation: null },
  ];
  must(
    'guest requests',
    await db.from('guest_requests').upsert(
      requests.map((r) => ({
        id: id('b', r.n),
        event_id: eventId,
        venue_id: STORE_DEMO.venueId,
        full_name: r.full_name,
        plus_ones: r.plus_ones,
        motivation: r.motivation,
      })),
      { onConflict: 'id', ignoreDuplicates: true },
    ),
  );
  must(
    'quota request',
    await db.from('quota_requests').upsert(
      {
        id: id('a', 1),
        event_id: eventId,
        venue_id: STORE_DEMO.venueId,
        user_id: SEED.tom,
        requested_extra: 4,
        motivation: 'Birthday group of five',
      },
      { onConflict: 'id', ignoreDuplicates: true },
    ),
  );
}

async function seedOtherNights(db) {
  const nights = [
    { eventId: id('0', 2), block: '1', name: 'Sunday Sessions', slug: 'sunday-sessions-demo', startMin: 2 * 24 * 60, count: 9 },
    { eventId: id('0', 3), block: '2', name: 'Warehouse Weekender', slug: 'warehouse-weekender-demo', startMin: 9 * 24 * 60, count: 6 },
    { eventId: id('0', 4), block: '3', name: 'Season Opening', slug: 'season-opening-demo', startMin: -7 * 24 * 60, count: 24 },
  ];
  for (const n of nights) {
    await upsertEvent(db, { eventId: n.eventId, name: n.name, slug: n.slug, startMin: n.startMin, hours: 6, capacity: 250 });
    const tiers = await upsertTiers(db, n.eventId, n.block);
    const rows = await simpleGuests(db, n.eventId, tiers, n.block, n.count, Number(n.block) * 3);
    if (n.startMin < 0) {
      await checkIn(db, n.eventId, rows.slice(0, 19), { firstMin: n.startMin + 20, spacingMin: 9, block: n.block });
    }
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!isLocalSupabaseUrl(SUPABASE_URL)) {
    console.error(
      `store seed: refusing to run — NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL || 'unset'}) is not a localhost Supabase. ` +
        'This script writes demo data and only ever runs against the local stack (pnpm supabase:start + pnpm dev:env).',
    );
    process.exit(1);
  }
  if (!SERVICE_KEY) {
    console.error('store seed: SUPABASE_SERVICE_ROLE_KEY is unset — run `pnpm dev:env` first.');
    process.exit(1);
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: venue, error } = await db.from('venues').select('id').eq('id', STORE_DEMO.venueId).maybeSingle();
  if (error || !venue) {
    console.error('store seed: Club Vesper is missing — the local stack has no supabase/seed.sql data (run `supabase db reset`).');
    process.exit(1);
  }

  await ensureDemoUser(db);
  await touchUpSeed(db);
  await seedLiveNight(db);
  await seedOtherNights(db);
  console.log(`store seed: demo night ready — log in as ${STORE_DEMO.email} (Club Vesper, "Neon Nights" live).`);
}

// Run only when executed directly, so a unit test can import the gate.
// pathToFileURL, not a template string: the main checkout's path has a space
// (`PlusOne Guestlist`), which import.meta.url percent-encodes.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
