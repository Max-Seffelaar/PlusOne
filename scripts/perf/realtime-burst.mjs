// Realtime burst harness — proves the #0b throttle fix (raise eventsPerSecond).
//
// WHAT IT MEASURES
//   supabase-js defaults realtime to `eventsPerSecond: 10`. The door + cockpit
//   subscribe to postgres_changes INSERT on `check_ins`; above ~10 check-ins/sec
//   the client SILENTLY drops events until the next refetch. This script
//   subscribes TWO independent clients to that exact stream — one at the default
//   10, one at 200 (our REALTIME_EVENTS_PER_SECOND) — then bursts N check-ins and
//   reports received/dropped + delivery-lag p50/p95 per subscriber, as a clean
//   before/after table. Baseline (#0b): 500 @ ~596/sec → default 10 received
//   0/500 (100% drop); 200 received 500/500 (lag p50 161ms / p95 219ms).
//
// LOCAL ONLY. Talks to the local Supabase stack with the service-role key (RLS is
// bypassed; that is fine for a perf harness, never ship this pattern to a route).
//
// ── PREREQUISITE: realtime publication (local quirk) ─────────────────────────
//   postgres_changes only fires for tables in the `supabase_realtime`
//   publication, and the LOCAL stack EMPTIES that publication on every restart
//   (see memory/local-supabase-quirks.md). If both subscribers report 0 received
//   even at 200, re-add the tables and re-run:
//
//     docker exec -i supabase_db_PlusOne_Guestlist psql -U postgres -d postgres -c \
//       "alter publication supabase_realtime add table public.check_ins, public.guests;"
//
//   (Idempotent-ish: it errors if a table is already a member — ignore that.)
//
// ── SOFT TEARDOWN (non-negotiable #3) ────────────────────────────────────────
//   Hard DELETE on guests/check_ins is REVOKED even for service_role
//   (full_schema.sql line 391). So this harness CANNOT delete the rows it makes.
//   Teardown is therefore SOFT: it voids the burst check-ins (voided_at) and sets
//   the throwaway guests to status='removed'. The throwaway venue/event/tier +
//   ~N removed guests PERSIST by design in a clearly-tagged namespace
//   ("zzz-rt-burst…") so they never get mistaken for real data. Re-runs reuse the
//   same fixed ids (idempotent setup), so the row count does not grow unboundedly.
//
// ── USAGE ────────────────────────────────────────────────────────────────────
//     node scripts/perf/realtime-burst.mjs            # N=500 (default)
//     node scripts/perf/realtime-burst.mjs 1000       # N=1000
//     BURST_N=1500 node scripts/perf/realtime-burst.mjs
//
//   Creds: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (env or .env.local).
//   DO NOT run this from a build session while someone is testing the shared stack
//   (shared-DB hygiene) — the orchestrator runs it serialized.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// ── Config ───────────────────────────────────────────────────────────────────
const BURST_N = Number(process.argv[2] ?? process.env.BURST_N ?? 500);
const DEFAULT_EPS = 10; // supabase-js default — the bug.
const RAISED_EPS = 200; // === REALTIME_EVENTS_PER_SECOND (the fix).
const SETTLE_MS = 3_000; // wait after the last insert for in-flight events to land.
const SUBSCRIBE_TIMEOUT_MS = 10_000;

// A fixed namespace so re-runs reuse the same throwaway rows (idempotent setup).
const NS = '0bbur570'; // -> ids look like 0bbur570-0000-7000-8000-............
const VENUE_ID = `${NS}-0000-7000-8000-000000000001`;
const EVENT_ID = `${NS}-0000-7000-8000-000000000002`;
const TIER_ID = `${NS}-0000-7000-8000-000000000003`;
// Reuse the admin seed user_profile for added_by / checked_by (it always exists).
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

// ── Creds (env or .env.local, mirrors scripts/dev-mfa.mjs) ───────────────────
function creds() {
  let env = {};
  try {
    const raw = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m) env[m[1]] = m[2];
    }
  } catch {
    /* no .env.local — rely on process.env */
  }
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  return { url, serviceKey };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

// ── A subscriber: one client at a given eventsPerSecond, tracking arrivals ────
function makeSubscriber(url, serviceKey, label, eventsPerSecond, guestIds) {
  const client = createClient(url, serviceKey, {
    realtime: { params: { eventsPerSecond } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const wanted = new Set(guestIds);
  const lags = []; // ms between insert (sentAt) and realtime delivery.
  const seen = new Set();
  const sentAt = new Map(); // guest_id -> epoch ms when we inserted its check-in.

  const channel = client
    .channel(`rt-burst-${label}-${uuidv7()}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins' }, (payload) => {
      const gid = payload.new?.guest_id;
      if (!gid || !wanted.has(gid) || seen.has(gid)) return;
      seen.add(gid);
      const t = sentAt.get(gid);
      if (t != null) lags.push(Date.now() - t);
    });

  return {
    label,
    eventsPerSecond,
    client,
    channel,
    markSent: (gid) => sentAt.set(gid, Date.now()),
    subscribe: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`${label}: subscribe timed out`)),
          SUBSCRIBE_TIMEOUT_MS,
        );
        channel.subscribe((st) => {
          if (st === 'SUBSCRIBED') {
            clearTimeout(timer);
            resolve();
          } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') {
            clearTimeout(timer);
            reject(new Error(`${label}: channel ${st}`));
          }
        });
      }),
    report: () => {
      const received = seen.size;
      const sorted = [...lags].sort((a, b) => a - b);
      return {
        label,
        eventsPerSecond,
        received,
        dropped: BURST_N - received,
        dropPct: ((BURST_N - received) / BURST_N) * 100,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
      };
    },
    teardown: async () => {
      try {
        await client.removeChannel(channel);
      } catch {
        /* best effort */
      }
    },
  };
}

// ── Idempotent throwaway scaffolding (venue/event/tier/guests) ───────────────
async function ensureScaffold(admin) {
  // upsert venue/event/tier (ignore-on-conflict via upsert).
  let { error } = await admin
    .from('venues')
    .upsert(
      { id: VENUE_ID, name: 'zzz-rt-burst (throwaway)', slug: `zzz-rt-burst-${NS}`, retention_months: 1 },
      { onConflict: 'id' },
    );
  if (error) throw new Error(`venue upsert: ${error.message}`);

  ({ error } = await admin.from('events').upsert(
    {
      id: EVENT_ID,
      venue_id: VENUE_ID,
      name: 'zzz-rt-burst event',
      starts_at: new Date().toISOString(),
      status: 'live',
      landing_slug: `zzz-rt-burst-${NS}`,
    },
    { onConflict: 'id' },
  ));
  if (error) throw new Error(`event upsert: ${error.message}`);

  ({ error } = await admin
    .from('guest_tiers')
    .upsert({ id: TIER_ID, event_id: EVENT_ID, name: 'Burst' }, { onConflict: 'id' }));
  if (error) throw new Error(`tier upsert: ${error.message}`);

  // Create N fresh guests for THIS burst (each needs its own row — check_ins.guest_id
  // is unique). Fresh UUIDv7 per run so previous runs' (now status='removed') guests
  // don't collide; status defaults to 'approved' so the check-in trigger fires.
  const guestIds = Array.from({ length: BURST_N }, () => uuidv7());
  const guests = guestIds.map((id, i) => ({
    id,
    event_id: EVENT_ID,
    tier_id: TIER_ID,
    full_name: `Burst Guest ${i}`,
    added_by: ACTOR_ID,
    status: 'approved',
  }));
  // Insert in chunks to keep the request bodies sane.
  for (let i = 0; i < guests.length; i += 500) {
    const chunk = guests.slice(i, i + 500);
    const { error: gErr } = await admin.from('guests').insert(chunk);
    if (gErr) throw new Error(`guests insert (chunk ${i}): ${gErr.message}`);
  }
  return guestIds;
}

// ── The burst: one check-in per guest, as fast as the server accepts ─────────
async function burst(admin, subscribers, guestIds) {
  const t0 = Date.now();
  // Fire inserts concurrently (bounded) to actually exceed 10/sec. Mark sentAt on
  // EVERY subscriber right before the insert so each computes its own lag.
  const CONCURRENCY = 50;
  let cursor = 0;
  async function worker() {
    while (cursor < guestIds.length) {
      const gid = guestIds[cursor++];
      for (const s of subscribers) s.markSent(gid);
      const { error } = await admin
        .from('check_ins')
        .insert({ guest_id: gid, checked_by: ACTOR_ID, device_id: 'rt-burst' });
      if (error) {
        // A failed insert just means no event for that guest; keep going.
        // (Log once-ish to avoid noise.)
        if (cursor % 100 === 0) console.warn(`  insert error @${cursor}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (Date.now() - t0) / 1000;
  return { elapsed, rate: guestIds.length / elapsed };
}

// ── Soft teardown — honour #3 (no hard delete): void check-ins + remove guests ─
async function softTeardown(admin, guestIds) {
  // Void the burst check-ins (keeps the row, no DELETE grant).
  const { error: vErr } = await admin
    .from('check_ins')
    .update({ voided_at: new Date().toISOString(), voided_by: ACTOR_ID })
    .in('guest_id', guestIds);
  if (vErr) console.warn(`  void check_ins: ${vErr.message}`);
  // Soft-remove the throwaway guests so they fall out of every count.
  for (let i = 0; i < guestIds.length; i += 500) {
    const chunk = guestIds.slice(i, i + 500);
    const { error: rErr } = await admin.from('guests').update({ status: 'removed' }).in('id', chunk);
    if (rErr) console.warn(`  remove guests (chunk ${i}): ${rErr.message}`);
  }
}

function printTable(rows) {
  const head = ['subscriber', 'eventsPerSecond', 'received', 'dropped', 'drop%', 'lag p50', 'lag p95'];
  const fmt = (r) => [
    r.label,
    String(r.eventsPerSecond),
    `${r.received}/${BURST_N}`,
    String(r.dropped),
    `${r.dropPct.toFixed(1)}%`,
    r.p50 == null ? '—' : `${r.p50}ms`,
    r.p95 == null ? '—' : `${r.p95}ms`,
  ];
  const data = [head, ...rows.map(fmt)];
  const widths = head.map((_, c) => Math.max(...data.map((row) => row[c].length)));
  const line = (row) => row.map((cell, c) => cell.padEnd(widths[c])).join('  ');
  console.log('\n' + line(data[0]));
  console.log(widths.map((w) => '─'.repeat(w)).join('  '));
  for (const row of data.slice(1)) console.log(line(row));
}

async function main() {
  const { url, serviceKey } = creds();
  if (!serviceKey) {
    console.error('Missing SUPABASE_SERVICE_ROLE_KEY (.env.local or env). Is the local stack up?');
    process.exit(1);
  }
  console.log(`realtime-burst: N=${BURST_N}, default ${DEFAULT_EPS} eps vs raised ${RAISED_EPS} eps`);
  console.log(`target: ${url}`);

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let guestIds = [];
  let subscribers = [];
  try {
    console.log(`\n• scaffolding throwaway venue/event/tier + ${BURST_N} guests…`);
    guestIds = await ensureScaffold(admin);

    subscribers = [
      makeSubscriber(url, serviceKey, `default-${DEFAULT_EPS}`, DEFAULT_EPS, guestIds),
      makeSubscriber(url, serviceKey, `raised-${RAISED_EPS}`, RAISED_EPS, guestIds),
    ];
    console.log('• subscribing both clients…');
    await Promise.all(subscribers.map((s) => s.subscribe()));
    // Small settle so the bindings are fully registered server-side before the burst.
    await sleep(500);

    console.log(`• bursting ${BURST_N} check-ins…`);
    const { elapsed, rate } = await burst(admin, subscribers, guestIds);
    console.log(`  inserted ${BURST_N} in ${elapsed.toFixed(2)}s (${rate.toFixed(0)}/sec)`);

    console.log(`• settling ${SETTLE_MS}ms for in-flight realtime events…`);
    await sleep(SETTLE_MS);

    printTable(subscribers.map((s) => s.report()));
    console.log(
      '\nInterpretation: the default-10 row should show heavy drops at this rate; the\n' +
        'raised-200 row should approach 0% drop. If BOTH are 0 received, re-add the\n' +
        'tables to supabase_realtime (see header) and re-run.\n',
    );
  } finally {
    console.log('• soft teardown (void check-ins + remove guests; #3 forbids hard delete)…');
    if (guestIds.length) await softTeardown(admin, guestIds);
    for (const s of subscribers) await s.teardown();
    // Give the sockets a tick to close so the process exits cleanly.
    await sleep(250);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
