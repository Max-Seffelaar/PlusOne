/**
 * Snelheid P2 finding 5 — before/after of the requests list (Home + Requests) on
 * the "Perf 300 events" venue (scripts/perf/p2-seed.mjs: 300 request links, one
 * pending + one denied request per event), admin@ through RLS.
 *
 * BEFORE is origin/main's fetchGuestRequests reproduced verbatim: every
 * pending/denied/auto row in one unranged read, then `request_links.in('id',
 * <every link id>)`, then influencers by id — three sequential round-trips; at
 * 300 links the id list passes Kong's URI limit. AFTER is the current source
 * with a cold links cache (the worst case: the hook reuses a warm one). Same
 * instrument both sides; median of 5.
 *
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *   node --env-file=.env.local scripts/perf/p2-measure-requests.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { meter, fmtKB } from './scale-audit.mjs';
import { adminUserClient, PERF_VENUE } from './p2-seed.mjs';

const RUNS = 5;
const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

async function oldFetchGuestRequests(client, venueId) {
  const { data, error } = await client
    .from('guest_requests')
    .select('id, full_name, email, phone, plus_ones, motivation, created_at, event_id, status, decision_reason, decision_message, request_link_id, decided_via, marketing_opt_in')
    .eq('venue_id', venueId)
    .is('anonymized_at', null)
    .or('status.in.(pending,denied),and(status.eq.approved,decided_via.eq.auto)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  const rows = data ?? [];
  const linkIds = [...new Set(rows.map((r) => r.request_link_id).filter(Boolean))];
  if (linkIds.length === 0) return rows;
  const { data: links, error: lErr } = await client.from('request_links').select('id, label, influencer_id, is_default').in('id', linkIds);
  if (lErr) throw lErr;
  const infIds = [...new Set((links ?? []).map((l) => l.influencer_id).filter(Boolean))];
  if (infIds.length) {
    const { error: iErr } = await client.from('influencers').select('id, name').in('id', infIds);
    if (iErr) throw iErr;
  }
  return rows;
}

async function median(fn) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await meter('x', fn));
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
    const since = new Date(Date.now() - RECENT_MS).toISOString();
    const sides = [
      ['before', () => oldFetchGuestRequests(client, PERF_VENUE)],
      ['after', () => po.fetchGuestRequests(client, PERF_VENUE, { decidedSinceIso: since })],
    ];
    console.log('| Requests list (Home / Requests) | Requests | Longest URL | Bytes | Time (median of 5) | Rows | Result |');
    console.log('|---|---|---|---|---|---|---|');
    for (const [side, fn] of sides) {
      const r = await median(fn);
      const broken = r.threw || r.errors.length;
      const result = broken ? `FAILS: ${r.threw?.message?.replace(/\s+/g, ' ').trim().slice(0, 60) ?? r.errors.join(',')}` : 'ok';
      console.log(`| ${side} | ${r.requests} | ${r.maxUrl} chars | ${fmtKB(r.bytes)} | ${Math.round(r.ms)} ms | ${r.out?.length ?? '—'} | ${result} |`);
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`[p2-measure-requests] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
