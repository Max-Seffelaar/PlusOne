/**
 * Snelheid P2 finding 14 — before/after of the reads behind adding one guest,
 * on a 1 000-guest event of the "Perf 300 events" venue (this script adds that
 * event idempotently; scripts/perf/p2-seed.mjs creates the venue). admin@
 * through RLS, median of 5, same instrument both sides.
 *
 * BEFORE (origin/main): after the add, the event's whole list re-downloads —
 *   usePoGuests = fetchGuests (every row + actor names) + a second guest_tiers
 *   read next to usePoTiers.
 * AFTER: one single-row read of the new guest (tiers come from the tiers query
 *   the screen already holds).
 *
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *   node --env-file=.env.local scripts/perf/p2-measure-minor.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { meter, fmtKB } from './scale-audit.mjs';
import { adminUserClient, serviceClient, PERF_VENUE } from './p2-seed.mjs';

const RUNS = 5;
const EVENT = 'fe0a3000-0000-7000-8000-e00000001000';
const TIER = 'fe0a3000-0000-7000-8000-d00000001000';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';

async function bigEvent() {
  const db = serviceClient();
  const start = new Date(Date.now() + 20 * 24 * 3600 * 1000);
  const must = (what, { error }) => { if (error) throw new Error(`${what}: ${error.message}`); };
  must('event', await db.from('events').upsert({
    id: EVENT, venue_id: PERF_VENUE, name: 'Perf 1000 guests', landing_slug: 'perf-1000-guests', status: 'open',
    starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 6 * 3600 * 1000).toISOString(),
  }, { onConflict: 'id' }));
  must('tier', await db.from('guest_tiers').upsert({ id: TIER, event_id: EVENT, name: 'Regular', color: '#8A8A93', aliases: [] }, { onConflict: 'id', ignoreDuplicates: true }));
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    id: `fe0a3000-0000-7000-8000-a1${String(i).padStart(10, '0')}`, event_id: EVENT, tier_id: TIER,
    full_name: `Big Guest ${i}`, plus_ones: 0, added_by: ADMIN_ID, source: 'app', status: 'approved',
  }));
  for (let i = 0; i < rows.length; i += 500) {
    must('guests', await db.from('guests').upsert(rows.slice(i, i + 500), { onConflict: 'id', ignoreDuplicates: true }));
  }
  return rows[rows.length - 1].id;
}

async function median(fn) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await meter('x', fn));
  const bad = runs.find((r) => r.threw || r.errors.length);
  if (bad) throw new Error(bad.threw?.message ?? bad.errors.join(','));
  runs.sort((a, b) => a.ms - b.ms);
  return runs[Math.floor(RUNS / 2)];
}

async function main() {
  const newest = await bigEvent();
  const client = await adminUserClient();
  const server = await createServer({
    configFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  });
  try {
    const po = await server.ssrLoadModule('@/features/po/queries.ts');
    const sides = [
      ['before', async () => (await Promise.all([po.fetchGuests(client, EVENT), po.fetchTiers(client, { eventId: EVENT })]))[0].length],
      ['after', async () => (await po.fetchGuests(client, EVENT, { guestId: newest })).length],
    ];
    console.log('| After adding one guest (1 000-guest event) | Requests | Bytes | Time (median of 5) | Rows |');
    console.log('|---|---|---|---|---|');
    for (const [side, fn] of sides) {
      const r = await median(fn);
      console.log(`| ${side} | ${r.requests} | ${fmtKB(r.bytes)} | ${Math.round(r.ms)} ms | ${r.out} |`);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`[p2-measure-minor] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
