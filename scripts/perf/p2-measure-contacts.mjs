/**
 * Snelheid P2 finding 6 — before/after of the address-book reads on the
 * "Perf 300 events" venue (scripts/perf/p2-seed.mjs: 3 000 contacts, 300 starred),
 * signed in as admin@plusone.test so every read goes through RLS like the app.
 *
 * BEFORE is hand-reproduced from origin/main's queries.ts (the client loop over
 * 120-id `guests.in('contact_id', …)` chunks, and the Regulars filter as the full
 * list filtered in JS). AFTER is the current source, loaded via Vite SSR.
 * Same instrument both sides: requests, response bytes, wall time (median of 5).
 *
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *   node --env-file=.env.local scripts/perf/p2-measure-contacts.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { meter, fmtKB } from './scale-audit.mjs';
import { adminUserClient, PERF_VENUE } from './p2-seed.mjs';

const RUNS = 5;

async function loadSource() {
  const server = await createServer({
    configFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  });
  const po = await server.ssrLoadModule('@/features/po/queries.ts');
  const paging = await server.ssrLoadModule('@/lib/supabase/paging.ts');
  return { server, fetchContacts: po.fetchContacts, fetchAllRanged: paging.fetchAllRanged, chunkIds: paging.chunkIds };
}

// ── BEFORE — origin/main fetchContacts + contactEventCounts ───────────────────
async function oldFetchContacts(client, venueId, { fetchAllRanged, chunkIds }) {
  const rows = await fetchAllRanged((from, to) =>
    client
      .from('contacts')
      .select('id, full_name, email, phone, birthdate, preferred_role, note, is_permanent')
      .eq('venue_id', venueId)
      .is('anonymized_at', null)
      .order('full_name')
      .order('id')
      .range(from, to),
  );
  const seen = new Map();
  for (const chunk of chunkIds(rows.map((c) => c.id), 120)) {
    const guests = await fetchAllRanged((from, to) =>
      client
        .from('guests')
        .select('contact_id, event_id')
        .in('contact_id', chunk)
        .neq('status', 'removed')
        .order('id')
        .range(from, to),
    );
    for (const g of guests) {
      if (!g.contact_id) continue;
      const set = seen.get(g.contact_id) ?? new Set();
      set.add(g.event_id);
      seen.set(g.contact_id, set);
    }
  }
  return rows.map((c) => ({ ...c, eventCount: seen.get(c.id)?.size ?? 0 }));
}

async function median(label, fn) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await meter(label, fn));
  const bad = runs.find((r) => r.threw || r.errors.length);
  if (bad) throw new Error(`${label}: ${bad.threw?.message ?? bad.errors.join(',')}`);
  runs.sort((a, b) => a.ms - b.ms);
  return runs[Math.floor(RUNS / 2)];
}

async function main() {
  const client = await adminUserClient();
  const src = await loadSource();
  try {
    const rows = [
      ['Contacten (address book)', 'before', () => oldFetchContacts(client, PERF_VENUE, src)],
      ['Contacten (address book)', 'after', () => src.fetchContacts(client, PERF_VENUE)],
      ['Guests tab · Regulars', 'before', async () => (await oldFetchContacts(client, PERF_VENUE, src)).filter((c) => c.is_permanent)],
      ['Guests tab · Regulars', 'after', () => src.fetchContacts(client, PERF_VENUE, { permanentOnly: true })],
    ];
    console.log('| Read | Side | Requests | Bytes | Time (median of 5) | Rows |');
    console.log('|---|---|---|---|---|---|');
    for (const [read, side, fn] of rows) {
      const r = await median(`${read} ${side}`, fn);
      console.log(`| ${read} | ${side} | ${r.requests} | ${fmtKB(r.bytes)} | ${Math.round(r.ms)} ms | ${r.out.length} |`);
    }
  } finally {
    await src.server.close();
  }
}

main().catch((err) => {
  console.error(`[p2-measure-contacts] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
