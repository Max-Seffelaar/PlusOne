/**
 * Snelheid P2, P1-review follow-up "single-event headcounts" — before/after of
 * usePoEvent's cache-miss path (a deep link / refresh on an event screen) on the
 * "Perf 300 events" venue (scripts/perf/p2-seed.mjs), admin@ through RLS.
 *
 * BEFORE (origin/main): the event row, THEN venue_event_headcounts with
 * p_since = that event's starts_at — for the oldest event that aggregates all
 * 300 events. AFTER (current source): both reads in parallel, the RPC scoped
 * with p_event_id. Same instrument both sides; median of 5.
 *
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *   node --env-file=.env.local scripts/perf/p2-measure-headcounts.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { meter, fmtKB } from './scale-audit.mjs';
import { adminUserClient, PERF_VENUE } from './p2-seed.mjs';

const RUNS = 5;

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
  const server = await createServer({
    configFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  });
  try {
    const po = await server.ssrLoadModule('@/features/po/queries.ts');
    const { data: oldest } = await client
      .from('events').select('id').eq('venue_id', PERF_VENUE).order('starts_at').limit(1).single();
    const eventId = oldest.id;

    const before = async () => {
      const [row] = await po.fetchEvents(client, PERF_VENUE, { eventId });
      const { data, error } = await client.rpc('venue_event_headcounts', { p_venue_id: PERF_VENUE, p_since: row.starts_at });
      if (error) throw error;
      return data;
    };
    const after = async () => {
      const [, heads] = await Promise.all([
        po.fetchEvents(client, PERF_VENUE, { eventId }),
        po.fetchEventHeadcounts(client, PERF_VENUE, { eventId }),
      ]);
      return [...heads.values()];
    };

    console.log('| Event screen, cache miss (oldest event) | Requests | Sequential waves | Headcount rows aggregated | Bytes | Time (median of 5) |');
    console.log('|---|---|---|---|---|---|');
    for (const [side, fn, waves] of [['before', before, 2], ['after', after, 1]]) {
      const r = await median(side, fn);
      console.log(`| ${side} | ${r.requests} | ${waves} | ${r.out.length} | ${fmtKB(r.bytes)} | ${Math.round(r.ms)} ms |`);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`[p2-measure-headcounts] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
