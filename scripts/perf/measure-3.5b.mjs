/**
 * STAP 3.5b before/after measurement harness (orchestrator-run, serialized).
 *
 * Seeds a FIXED-id throwaway event with ~1500 guests on the seed venue, then
 * proves the #0a ranged-reads fix against the REAL source functions:
 *   - BEFORE: a raw single `.select()` (no `.range()`) truncates at 1000 rows
 *     (Content-Range 0-999/1500) — the bug.
 *   - AFTER : fetchDoorSnapshot / fetchGuests / fetchEventHeadcounts /
 *     fetchCheckinArrivals return the FULL 1500.
 *
 * Teardown is NOT done here (hard DELETE is revoked even for service_role,
 * decision #3) — the orchestrator reaps the fixed event via superuser psql after
 * all runtime measurements (cold-load / INP / CLS / realtime) run against it.
 *
 * Usage:
 *   SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 \
 *     node scripts/perf/measure-3.5b.mjs <seed|prove|seed+prove>
 *
 * Service-role use is test-only (RLS bypass to seed/measure a throwaway event);
 * app code never does this.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const VENUE_ID = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper (seed)
const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111'; // seed admin profile
// Fixed ids so superuser psql can reap deterministically after the runtime runs.
const EVENT_ID = 'ff000000-0000-7000-8000-0000035b1500';
const TIER_ID = 'ff000000-0000-7000-8000-0000035b7e10';
const GUEST_COUNT = 1500;

const mode = process.argv[2] ?? 'seed+prove';

function log(step, msg) {
  console.log(`[3.5b] ${step.padEnd(9)} ${msg}`);
}

async function loadSource() {
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  });
  try {
    const door = await server.ssrLoadModule('@/features/door/queries.ts');
    const po = await server.ssrLoadModule('@/features/po/queries.ts');
    return {
      server,
      fetchDoorSnapshot: door.fetchDoorSnapshot,
      fetchGuests: po.fetchGuests,
      fetchEventHeadcounts: po.fetchEventHeadcounts,
      fetchCheckinArrivals: po.fetchCheckinArrivals,
    };
  } catch (err) {
    await server.close();
    throw err;
  }
}

async function seed(admin) {
  log('seed', `creating fixed event ${EVENT_ID} (${GUEST_COUNT} guests) on ${VENUE_ID}`);
  const { error: evErr } = await admin.from('events').insert({
    id: EVENT_ID,
    venue_id: VENUE_ID,
    name: '__3.5b_measure__ (throwaway 1500)',
    starts_at: '2026-01-01 22:00:00+01',
    ends_at: '2026-01-02 05:00:00+01',
    status: 'live',
    landing_slug: 'measure-35b-1500',
    landing_active: false,
  });
  if (evErr) throw new Error(`event insert failed: ${evErr.message}`);

  const { error: tErr } = await admin.from('guest_tiers').insert({
    id: TIER_ID,
    event_id: EVENT_ID,
    name: 'Measure',
    color: '#8A8A93',
    aliases: [],
  });
  if (tErr) throw new Error(`tier insert failed: ${tErr.message}`);

  const BATCH = 500;
  let inserted = 0;
  for (let start = 0; start < GUEST_COUNT; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, GUEST_COUNT); i++) {
      // Sprinkle plus-ones so headcounts are non-trivial (every 5th guest +2).
      rows.push({
        id: uuidv7(),
        event_id: EVENT_ID,
        tier_id: TIER_ID,
        full_name: `Meet Gast ${String(i).padStart(4, '0')}`,
        plus_ones: i % 5 === 0 ? 2 : 0,
        added_by: ADMIN_USER_ID,
        source: 'app',
        status: 'approved',
      });
    }
    const { error } = await admin.from('guests').insert(rows);
    if (error) throw new Error(`guest batch insert failed at ${start}: ${error.message}`);
    inserted += rows.length;
  }
  log('seed', `inserted ${inserted} guests`);
}

async function prove(admin, src) {
  // BEFORE: raw single select, no .range() — reproduces the 1000-row truncation.
  const raw = await admin
    .from('guests')
    .select('id', { count: 'exact' })
    .eq('event_id', EVENT_ID)
    .neq('status', 'removed');
  log('BEFORE', `raw single .select() returned ${raw.data?.length} rows (server count=${raw.count}) → truncated at 1000`);

  // AFTER: the shipping ranged functions.
  const snapshot = await src.fetchDoorSnapshot(admin, EVENT_ID);
  log('AFTER', `fetchDoorSnapshot.guests = ${snapshot.guests.length}`);

  const poGuests = await src.fetchGuests(admin, { eventId: EVENT_ID });
  log('AFTER', `fetchGuests = ${poGuests.length}`);

  const heads = await src.fetchEventHeadcounts(admin, VENUE_ID);
  const hc = heads.get(EVENT_ID);
  log('AFTER', `fetchEventHeadcounts.registered = ${hc?.registered} koppen (1500 + 300×+2 = 1800 expected)`);

  const arrivals = await src.fetchCheckinArrivals(admin, EVENT_ID);
  log('AFTER', `fetchCheckinArrivals map size = ${arrivals.size} (0 before any check-in)`);

  const pass =
    snapshot.guests.length === GUEST_COUNT &&
    poGuests.length === GUEST_COUNT &&
    hc?.registered === GUEST_COUNT + (GUEST_COUNT / 5) * 2;
  log(pass ? 'PASS' : 'FAIL', pass
    ? `all ranged reads return the full ${GUEST_COUNT}; raw select truncated to ${raw.data?.length}.`
    : `expected ${GUEST_COUNT} everywhere + ${GUEST_COUNT + (GUEST_COUNT / 5) * 2} koppen.`);
  if (!pass) process.exitCode = 1;
}

async function main() {
  if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required.');
  const { server, ...src } = await loadSource();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    if (mode.includes('seed')) await seed(admin);
    if (mode.includes('prove')) await prove(admin, src);
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`[3.5b] FAILED — ${err?.message ?? err}`);
  process.exitCode = 1;
});
