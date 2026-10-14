/**
 * Snelheid P2 findings 4 + 12 — before/after of the event reads behind Home and
 * the Events tab on the "Perf 300 events" venue (scripts/perf/p2-seed.mjs: 240
 * past events, one a day, and 60 upcoming), admin@ through RLS.
 *
 * Scenario: open Home on a desktop (Home board + the desktop door auto-open's
 * candidates), then tap Events.
 *   BEFORE (origin/main): Home = events + headcounts for 7 days; door candidates
 *     = EVERY event; Events tab = EVERY event + headcounts over every event.
 *   AFTER (this branch): one window (upcoming + 30 days) of events + headcounts
 *     that Home and Events share through `select`; door candidates = the window;
 *     Events tab = served from the cache (0 requests). The trade: Home's 10 s
 *     poll now refreshes the 30-day window instead of 7 days (last row).
 * Same instrument both sides (requests, bytes, wall time, rows); median of 5.
 *
 *   node --env-file=.env.local scripts/perf/p2-seed.mjs
 *   node --env-file=.env.local scripts/perf/p2-measure-events.mjs
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { meter, fmtKB } from './scale-audit.mjs';
import { adminUserClient, PERF_VENUE } from './p2-seed.mjs';

const RUNS = 5;
const DAY = 24 * 60 * 60 * 1000;

async function median(fn) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await meter('x', fn));
  const bad = runs.find((r) => r.threw || r.errors.length);
  if (bad) throw new Error(bad.threw?.message ?? bad.errors.join(','));
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
    const v = PERF_VENUE;
    const since = (days) => new Date(Date.now() - days * DAY).toISOString();
    const rowsOf = (...lists) => lists.reduce((n, l) => n + (l instanceof Map ? l.size : l.length), 0);

    const steps = {
      before: {
        'Home (board + door candidates)': async () => {
          const [a, b, c] = await Promise.all([
            po.fetchEvents(client, v, { sinceIso: since(7) }),
            po.fetchEventHeadcounts(client, v, since(7)),
            po.fetchEvents(client, v),
          ]);
          return rowsOf(a, b, c);
        },
        'then tap Events': async () => {
          const [a, b] = await Promise.all([po.fetchEvents(client, v), po.fetchEventHeadcounts(client, v)]);
          return rowsOf(a, b);
        },
        'Home poll tick (every 10 s while Home is open)': async () => {
          const [a, b] = await Promise.all([
            po.fetchEvents(client, v, { sinceIso: since(7) }),
            po.fetchEventHeadcounts(client, v, since(7)),
          ]);
          return rowsOf(a, b);
        },
      },
      after: {
        'Home (board + door candidates)': async () => {
          const s = since(30);
          const [a, b, c] = await Promise.all([
            po.fetchEvents(client, v, { sinceIso: s }),
            po.fetchEventHeadcounts(client, v, s),
            po.fetchEvents(client, v, { sinceIso: s }),
          ]);
          return rowsOf(a, b, c);
        },
        'then tap Events': async () => 0,
        'Home poll tick (every 10 s while Home is open)': async () => {
          const s = since(30);
          const [a, b] = await Promise.all([po.fetchEvents(client, v, { sinceIso: s }), po.fetchEventHeadcounts(client, v, s)]);
          return rowsOf(a, b);
        },
      },
    };

    console.log('| Step | Side | Requests | Bytes | Time (median of 5) | Rows read |');
    console.log('|---|---|---|---|---|---|');
    for (const step of Object.keys(steps.before)) {
      for (const side of ['before', 'after']) {
        const r = await median(steps[side][step]);
        console.log(`| ${step} | ${side} | ${r.requests} | ${fmtKB(r.bytes)} | ${Math.round(r.ms)} ms | ${r.out} |`);
      }
    }
  } finally {
    await server.close();
  }
}

main().catch((err) => {
  console.error(`[p2-measure-events] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
