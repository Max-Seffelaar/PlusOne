/**
 * TRUE same-machine before/after of the venue-scope read fix (#143 —
 * SCALE-5/K8/FE-3, commit e93d3dc). A/B's the OLD `.in(eventIds)` query shape
 * against the NEW venue-scoped shape, against the SAME seeded data in the SAME
 * run — only the query shape differs, no schema/seed/timing confounds.
 *
 * The "BEFORE" functions below are hand-reproduced verbatim from
 * `git show e93d3dc^:src/features/po/queries.ts` (the commit's parent, i.e. the
 * last commit before the fix landed). They are NOT imported from source — that
 * source no longer exists — but they use the same `fetchAllRanged` paging
 * helper (unchanged by #143, loaded live via Vite SSR from the current tree)
 * so the paging behaviour is faithful, not approximated.
 *
 * The "AFTER" functions are the CURRENT source functions, loaded the same way
 * scale-audit.mjs does it (Vite SSR `ssrLoadModule`).
 *
 * Reuses scale-audit.mjs's seed/seedFleet/burst/teardown/meter infra so the
 * exact same throwaway data (fleet: 1 venue × 400 events; mega: 25k/2.5k-guest
 * events) backs both shapes — importing that module does NOT trigger its own
 * run (entrypoint-guarded).
 *
 * Usage (from the worktree, creds from .env.local, local stack only):
 *   node -r dotenv/config scripts/perf/scale-beforeafter.mjs <fleet|mega|burst|teardown|all> dotenv_config_path=.env.local
 */
import { createClient } from '@supabase/supabase-js';
import {
  SUPABASE_URL, SERVICE_ROLE_KEY, VENUE_ID, FLEET,
  fmtKB, log, meter,
  loadSource, seed, seedFleet, burst, teardown,
} from './scale-audit.mjs';

const ON_LIST = ['approved', 'checked_in']; // mirrors queries.ts's private ON_LIST

const mode = process.argv[2] ?? 'all';

// ── BEFORE shapes — hand-reproduced from e93d3dc^ src/features/po/queries.ts ──

/** Pre-fix fetchVenueGuests(client, eventIds) — the "All guests" venue-wide read. */
function oldFetchVenueGuests(client, eventIds, fetchAllRanged) {
  if (eventIds.length === 0) return Promise.resolve([]);
  return fetchAllRanged((from, to) =>
    client
      .from('guests')
      .select('id, full_name, plus_ones, status, tier_id, note, note_priority, created_at, contact_id, event_id')
      .in('event_id', eventIds)
      .neq('status', 'removed')
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, to),
  );
}

/** Pre-fix fetchVenueTiers(client, eventIds). */
async function oldFetchVenueTiers(client, eventIds) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client
    .from('guest_tiers')
    .select('id, name, color, max_guests, aliases, door_price_cents, vat_percent')
    .in('event_id', eventIds)
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Pre-fix fetchEventHeadcounts(client, eventIds) — downloads every on-list
 *  guest row across the given events and sums client-side (the K8 bug). */
async function oldFetchEventHeadcounts(client, eventIds, fetchAllRanged) {
  const counts = new Map();
  if (eventIds.length === 0) return counts;
  const data = await fetchAllRanged((from, to) =>
    client
      .from('guests')
      .select('event_id, plus_ones, status')
      .in('event_id', eventIds)
      .in('status', ON_LIST)
      .order('id')
      .range(from, to),
  );
  for (const g of data) {
    const cur = counts.get(g.event_id) ?? { registered: 0, present: 0 };
    const heads = 1 + g.plus_ones;
    cur.registered += heads;
    if (g.status === 'checked_in') cur.present += heads;
    counts.set(g.event_id, cur);
  }
  return counts;
}

/** Pre-fix fetchGuestRequests(client, eventIds). */
async function oldFetchGuestRequests(client, eventIds) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client
    .from('guest_requests')
    .select(
      'id, full_name, phone, plus_ones, motivation, created_at, event_id, status, decision_reason, request_link_id, decided_via',
    )
    .in('event_id', eventIds)
    .or('status.in.(pending,denied),and(status.eq.approved,decided_via.eq.auto)')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Pre-fix fetchQuotaRequests(client, eventIds). */
async function oldFetchQuotaRequests(client, eventIds) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client
    .from('quota_requests')
    .select('id, event_id, requested_extra, motivation, created_at, user_id')
    .in('event_id', eventIds)
    .eq('status', 'pending')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** Pre-fix fetchVenueRequestLinks(client, eventIds). */
async function oldFetchVenueRequestLinks(client, eventIds) {
  if (eventIds.length === 0) return [];
  const { data, error } = await client
    .from('request_links')
    .select('id, event_id, is_default, label, influencer_id')
    .in('event_id', eventIds)
    .is('archived_at', null)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

// ── reporting ──────────────────────────────────────────────────────────────

function sizeOf(out) {
  if (out == null) return '?';
  if (out instanceof Map) return `${out.size} row(s)`;
  if (Array.isArray(out)) return `${out.length} row(s)`;
  return '?';
}

function fmtResult(r) {
  const errTag = r.threw
    ? ` ⚠ THREW: ${r.threw.message ?? r.threw}`
    : r.errors.length
      ? ` ⚠ non-2xx: ${r.errors.join(',')}`
      : '';
  return (
    `${String(Math.round(r.ms)).padStart(6)} ms  ${String(r.requests).padStart(3)} req  ` +
    `${fmtKB(r.bytes).padStart(9)}  url≤${String(r.maxUrl).padStart(6)} chars  ${sizeOf(r.out)}${errTag}`
  );
}

/** One BEFORE→AFTER delta line: × fewer requests, × fewer bytes, 414→OK. */
async function reportDelta(name, beforeFn, afterFn) {
  const before = await meter(`${name} BEFORE`, beforeFn);
  const after = await meter(`${name} AFTER`, afterFn);
  console.log(`  ${name}`);
  console.log(`    BEFORE  ${fmtResult(before)}`);
  console.log(`    AFTER   ${fmtResult(after)}`);

  const beforeBroken = Boolean(before.threw) || before.errors.length > 0;
  const urlDelta = before.maxUrl > 0 ? `${(before.maxUrl / Math.max(after.maxUrl, 1)).toFixed(1)}×` : 'n/a';
  const reqDelta = !beforeBroken ? `${(before.requests / Math.max(after.requests, 1)).toFixed(1)}×` : '—';
  const byteDelta = !beforeBroken ? `${(before.bytes / Math.max(after.bytes, 1)).toFixed(1)}×` : '—';
  const statusFlip = beforeBroken && !after.threw && !after.errors.length
    ? '414/error → OK'
    : !beforeBroken && !after.threw && !after.errors.length
      ? 'both OK'
      : 'see ⚠ above';
  console.log(
    `    DELTA   URL ${urlDelta} shorter, requests ${reqDelta} fewer, bytes ${byteDelta} fewer, status: ${statusFlip}`,
  );
  console.log('');
  return { name, before, after };
}

// ── dimension 1: fleet (1 venue × 400 events) — the SCALE-5 414 case ────────

async function beforeAfterFleet(admin, src) {
  console.log(`\n══ FLEET — 1 venue × ${FLEET.events} events (SCALE-5/K8/FE-3, the 414 axis) ══`);
  const { data: evs, error } = await admin.from('events').select('id').eq('venue_id', FLEET.venue).order('id');
  if (error) throw error;
  const eventIds = (evs ?? []).map((r) => r.id);
  log('fleet', `venue has ${eventIds.length} events — BEFORE queries send every id in one .in() filter, AFTER sends one venue_id`);

  const results = [];
  results.push(await reportDelta(
    'fetchGuests (All-guests tab)',
    () => oldFetchVenueGuests(admin, eventIds, src.fetchAllRanged),
    () => src.fetchGuests(admin, { venueId: FLEET.venue }),
  ));
  results.push(await reportDelta(
    'fetchTiers',
    () => oldFetchVenueTiers(admin, eventIds),
    () => src.fetchTiers(admin, { venueId: FLEET.venue }),
  ));
  results.push(await reportDelta(
    'fetchEventHeadcounts (Home tile)',
    () => oldFetchEventHeadcounts(admin, eventIds, src.fetchAllRanged),
    () => src.fetchEventHeadcounts(admin, FLEET.venue),
  ));
  results.push(await reportDelta(
    'fetchGuestRequests (Requests inbox)',
    () => oldFetchGuestRequests(admin, eventIds),
    () => src.fetchGuestRequests(admin, FLEET.venue),
  ));
  results.push(await reportDelta(
    'fetchQuotaRequests (Requests inbox)',
    () => oldFetchQuotaRequests(admin, eventIds),
    () => src.fetchQuotaRequests(admin, FLEET.venue),
  ));
  results.push(await reportDelta(
    'fetchVenueRequestLinks',
    () => oldFetchVenueRequestLinks(admin, eventIds),
    () => src.fetchVenueRequestLinks(admin, FLEET.venue),
  ));
  return results;
}

// ── dimension 2: mega (1 venue, one 25k-guest event) — the K8 volume case ───

async function beforeAfterMega(admin, src) {
  console.log('\n══ MEGA — 1 venue, 25k-guest event (K8, the download-volume axis) ══');
  const { data: evs, error } = await admin.from('events').select('id').eq('venue_id', VENUE_ID).order('id');
  if (error) throw error;
  const eventIds = (evs ?? []).map((r) => r.id);
  log('mega', `venue has ${eventIds.length} events (small URL either way) — this axis is about ROWS DOWNLOADED, not URL length`);

  const results = [];
  results.push(await reportDelta(
    'fetchEventHeadcounts (Home tile)',
    () => oldFetchEventHeadcounts(admin, eventIds, src.fetchAllRanged),
    () => src.fetchEventHeadcounts(admin, VENUE_ID),
  ));
  return results;
}

async function beforeAfterBurst(admin) {
  console.log('\n══ WRITE THROUGHPUT — unchanged by #143 (read-path-only fix) ══');
  return burst(admin);
}

async function main() {
  if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required (test-only service client).');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let server;
  try {
    if (mode === 'teardown') { await teardown(admin); return; }
    const src = await loadSource();
    server = src.server;

    if (mode === 'fleet' || mode === 'all') { await seedFleet(admin); await beforeAfterFleet(admin, src); }
    if (mode === 'mega' || mode === 'all') { await seed(admin); await beforeAfterMega(admin, src); }
    if (mode === 'burst' || mode === 'all') await beforeAfterBurst(admin);

    console.log('');
    log('done', `mode=${mode}. Reap with: node scripts/perf/scale-beforeafter.mjs teardown  (or pnpm db:fresh)`);
  } finally {
    if (server) await server.close();
  }
}
main().catch((err) => { console.error(`[beforeafter] FAILED — ${err?.message ?? err}`); process.exitCode = 1; });
