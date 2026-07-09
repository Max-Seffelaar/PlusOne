/**
 * Scale audit — mega-event dimension (25 000 guests, 45 concurrent scanners)
 * AND the events-per-venue dimension (SCALE-5/K8/FE-3, 400 events on one venue).
 *
 * CLAUDE.md assumes "50–150 guests per event". This harness stresses two axes the
 * app was NOT designed around: ONE event an order of magnitude bigger (mega-event,
 * 45-way concurrent check-in write path), and ONE venue with hundreds of events
 * (fleet — the events-per-venue axis `fetchEvents` has no date bound on). It seeds
 * throwaway data and measures the REAL source functions via Vite SSR:
 *
 *   READS  (requests + bytes + ms + longest request URL, metered on global fetch):
 *     - fetchDoorSnapshot        @25k and @2.5k  (door cold-load payload)
 *     - fetchGuests              @25k            (guests-tab / lijst)
 *     - fetchEventHeadcounts     @venue          (K8 fan-out: Home tile, every 10s)
 *     - fetchGuests/fetchTiers/fetchGuestRequests/fetchQuotaRequests/
 *       fetchVenueRequestLinks   @400-event venue (SCALE-5 fleet mode — every
 *       venue-wide read that used to ship an event-id list)
 *   WRITES (throughput + p50/p95/p99 + errors + correctness):
 *     - 45 concurrent "scanners" inserting distinct check_ins on the 25k event
 *       (BEFORE-trigger set_checkin_scope + cap/scope triggers under contention).
 *
 * HONEST SCOPE — what local CANNOT tell you:
 *   - Realtime fan-out / the postgres_changes per-subscriber-RLS ceiling: that is
 *     the binding constraint at scale and is HOSTED-ONLY (scripts/perf/
 *     realtime-loadtest-hosted.mjs). This script uses the service client, which
 *     BYPASSES RLS — so write numbers exclude the per-row RLS CPU that dominates
 *     on a real tier. Treat local latency as a floor, not a prediction.
 *
 * SCALE-5/K8/FE-3 STATUS (2026-07-09): FIXED. `fetchEventHeadcounts` now takes a
 * venueId (was an eventIds list) and calls the `venue_event_headcounts` GROUP BY
 * RPC; `fetchGuests`/`fetchTiers`/`fetchGuestRequests`/`fetchQuotaRequests`/
 * `fetchVenueRequestLinks` all take `{venueId}` scope instead of an eventIds list
 * (migration `20260708120000_venue_scope_denormalization.sql`, denormalizes
 * `venue_id` onto guests/guest_requests/quota_requests/guest_tiers). The
 * `fleet` mode below is now a REGRESSION GUARD (proves the fix holds at 400
 * events), not just a repro of the bug.
 *
 * Headcount is deliberately ROLE-RELATIVE, not a bypass: `venue_event_headcounts`
 * is SECURITY INVOKER (not DEFINER), so it runs under the CALLER's own
 * `guests_select` RLS — a staff member's headcount tile stays scoped to their own
 * added guests, exactly like the row-by-row read it replaces. This script uses the
 * service-role client (bypasses RLS entirely), so it always sees the FULL venue
 * aggregate — it does not exercise the per-role scoping; that's covered by
 * `supabase/tests/database/venue_scope_denormalization.test.sql` (pgTAP, role
 * switching).
 *
 * SHARED-DB NOTE: seeds ~27.5k throwaway guest rows (mega-event) + 400 events ×
 * 5 guests (fleet) on the local stack. Teardown tries a hard delete (test-only
 * service client); if the grant is revoked it soft-removes and you clean up with
 * `pnpm db:fresh`. Run ONLY when no other session is mid-test (CLAUDE.md
 * one-DB-owner rule).
 *
 * Usage (from the worktree, creds from .env.local):
 *   node -r dotenv/config scripts/perf/scale-audit.mjs <seed|measure|burst|fleet|teardown|all>  dotenv_config_path=.env.local
 * or explicit:
 *   SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 \
 *     node scripts/perf/scale-audit.mjs fleet
 */
import { createServer } from 'vite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
export const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const VENUE_ID = 'aa000000-0000-7000-8000-000000000001'; // Club Vesper (seed)
export const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111'; // seed admin profile

// Fixed ids in a dedicated namespace so a rerun is idempotent and reaping is easy.
export const MEGA = { event: 'fe000000-0000-7000-8000-000000025000', tier: 'fe000000-0000-7000-8000-0000000750a0', count: 25000, slug: 'scale-audit-mega-25k' };
export const MID = { event: 'fe000000-0000-7000-8000-000000002500', tier: 'fe000000-0000-7000-8000-0000000750b0', count: 2500, slug: 'scale-audit-mid-2500' };

export const SCANNERS = 45; // concurrent door devices on the mega-event
export const CHECKINS_PER_SCANNER = 60; // 45 × 60 = 2700 check-ins in the burst

// Fleet axis: one long-lived venue with MANY events (the events-per-venue axis
// SCALE-5 broke). A handful of the fleet's events also get a guest_request +
// quota_request, so fetchGuestRequests/fetchQuotaRequests have real rows to
// return, not just an empty (still-passing-but-uninteresting) []. Every event
// auto-gets a default request_link via the existing landing-page trigger, so
// fetchVenueRequestLinks is exercised on ALL 400 with no extra seeding.
export const FLEET = { venue: 'fe000000-0000-7000-8000-00000000f1ee', events: 400, guestsPer: 5, withRequests: 5, tierBase: 'fe020000-0000-7000-8000-', eventBase: 'fe010000-0000-7000-8000-' };
export const pad12 = (n) => String(n).padStart(12, '0');

const mode = process.argv[2] ?? 'all';
export const fmtN = (n) => n.toLocaleString('en-US');
export const fmtKB = (b) => `${(b / 1024).toFixed(0)} kB`;
export const fmtMB = (b) => `${(b / 1024 / 1024).toFixed(2)} MB`;
export function log(step, msg) { console.log(`[scale] ${step.padEnd(9)} ${msg}`); }

// ── fetch meter: count requests + bytes + longest URL during a measured block ──
export function makeMeter() {
  const orig = globalThis.fetch;
  let requests = 0;
  let bytes = 0;
  let maxUrl = 0;
  const errors = [];
  globalThis.fetch = async (...args) => {
    requests += 1;
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url ?? '';
    if (url.length > maxUrl) maxUrl = url.length;
    const res = await orig(...args);
    const cl = res.headers.get('content-length');
    if (cl) bytes += Number(cl);
    if (!res.ok) errors.push(res.status);
    return res;
  };
  return {
    stop: () => { globalThis.fetch = orig; return { requests, bytes, maxUrl, errors }; },
  };
}
export async function meter(label, fn) {
  const m = makeMeter();
  const t0 = performance.now();
  let out;
  let threw = null;
  try { out = await fn(); } catch (err) { threw = err; } finally { /* restore below */ }
  const ms = performance.now() - t0;
  const { requests, bytes, maxUrl, errors } = m.stop();
  return { label, ms, requests, bytes, maxUrl, errors, out, threw };
}
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export async function loadSource() {
  const server = await createServer({
    configFile: false, appType: 'custom', logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  });
  try {
    const door = await server.ssrLoadModule('@/features/door/queries.ts');
    const po = await server.ssrLoadModule('@/features/po/queries.ts');
    const paging = await server.ssrLoadModule('@/lib/supabase/paging.ts');
    return {
      server,
      fetchDoorSnapshot: door.fetchDoorSnapshot,
      fetchEvents: po.fetchEvents,
      fetchGuests: po.fetchGuests,
      fetchTiers: po.fetchTiers,
      fetchEventHeadcounts: po.fetchEventHeadcounts,
      fetchGuestRequests: po.fetchGuestRequests,
      fetchQuotaRequests: po.fetchQuotaRequests,
      fetchVenueRequestLinks: po.fetchVenueRequestLinks,
      fetchCheckinArrivals: po.fetchCheckinArrivals,
      // Unchanged by #143 — the BEFORE-shape reproductions in
      // scale-beforeafter.mjs page through `.in(eventIds)` results the same
      // way the real pre-fix functions did.
      fetchAllRanged: paging.fetchAllRanged,
    };
  } catch (err) { await server.close(); throw err; }
}

export async function seedEvent(admin, ev) {
  const existing = await admin.from('guests').select('id', { count: 'exact', head: true }).eq('event_id', ev.event);
  if ((existing.count ?? 0) >= ev.count) { log('seed', `${ev.slug} already has ${existing.count} guests — skip`); return; }
  await admin.from('events').upsert({
    id: ev.event, venue_id: VENUE_ID, name: `__scale__ ${ev.slug}`,
    starts_at: '2026-01-01 22:00:00+01', ends_at: '2026-01-02 05:00:00+01',
    status: 'live', landing_slug: ev.slug, landing_active: false,
  }, { onConflict: 'id' });
  await admin.from('guest_tiers').upsert({ id: ev.tier, event_id: ev.event, name: 'Scale', color: '#8A8A93', aliases: [] }, { onConflict: 'id' });

  const BATCH = 1000;
  let inserted = 0;
  for (let start = 0; start < ev.count; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(start + BATCH, ev.count); i++) {
      rows.push({
        id: uuidv7(), event_id: ev.event, tier_id: ev.tier,
        full_name: `Scale Gast ${String(i).padStart(5, '0')}`,
        plus_ones: i % 5 === 0 ? 2 : 0, // 20% carry +2 → headcount ≠ row count
        added_by: ADMIN_USER_ID, source: 'app', status: 'approved',
      });
    }
    const { error } = await admin.from('guests').insert(rows);
    if (error) throw new Error(`guest batch @${start} (${ev.slug}): ${error.message}`);
    inserted += rows.length;
    if (inserted % 5000 === 0) log('seed', `${ev.slug}: ${fmtN(inserted)}/${fmtN(ev.count)}`);
  }
  log('seed', `${ev.slug}: inserted ${fmtN(inserted)} guests`);
}

export async function seed(admin) {
  await seedEvent(admin, MEGA);
  await seedEvent(admin, MID);
}

export async function measure(admin, src) {
  console.log('\n── READS ──────────────────────────────────────────────────────');
  const rows = [];
  const snap25 = await meter('door snapshot @25k', () => src.fetchDoorSnapshot(admin, MEGA.event));
  rows.push({ ...snap25, extra: `${fmtN(snap25.out.guests.length)} guests` });
  const snap25ok = snap25.out.guests.length === MEGA.count;

  const snap2 = await meter('door snapshot @2.5k', () => src.fetchDoorSnapshot(admin, MID.event));
  rows.push({ ...snap2, extra: `${fmtN(snap2.out.guests.length)} guests` });

  const po25 = await meter('fetchGuests @25k', () => src.fetchGuests(admin, { eventId: MEGA.event }));
  rows.push({ ...po25, extra: `${fmtN(po25.out.length)} guests` });

  // Post-fix: ONE venue_id (Club Vesper), not an eventIds list — the RPC
  // aggregates every event at the venue (incl. MEGA/MID + the regular seed event).
  const heads = await meter('fetchEventHeadcounts venue', () => src.fetchEventHeadcounts(admin, VENUE_ID));
  const hc = heads.out.get(MEGA.event);
  rows.push({ ...heads, extra: `${fmtN(hc?.registered ?? 0)} koppen (mega)` });

  for (const r of rows) {
    console.log(
      `  ${r.label.padEnd(28)} ${String(Math.round(r.ms)).padStart(6)} ms  ` +
      `${String(r.requests).padStart(3)} req  ${fmtMB(r.bytes).padStart(9)}   ${r.extra}`,
    );
  }
  // Sanity: ranged reads must return the FULL 25k (the #0a cap would show 1000).
  log(snap25ok ? 'PASS' : 'FAIL', snap25ok
    ? `door snapshot returned all ${fmtN(MEGA.count)} guests (ranged reads hold at 25k).`
    : `door snapshot returned ${snap25.out.guests.length} — TRUNCATION at 25k.`);
  const expectHeads = MEGA.count + (MEGA.count / 5) * 2;
  log(hc?.registered === expectHeads ? 'PASS' : 'WARN',
    `headcount mega = ${fmtN(hc?.registered ?? 0)} (expected ${fmtN(expectHeads)}).`);
  return { snap25, heads };
}

export async function burst(admin) {
  console.log(`\n── WRITE BURST — ${SCANNERS} concurrent scanners × ${CHECKINS_PER_SCANNER} check-ins ──`);
  // Pull uncheck-in-ed guest ids for the mega event (ranged, need > 2700).
  const need = SCANNERS * CHECKINS_PER_SCANNER;
  const ids = [];
  for (let from = 0; ids.length < need; from += 1000) {
    const { data, error } = await admin.from('guests').select('id').eq('event_id', MEGA.event).order('id').range(from, from + 999);
    if (error) throw new Error(`guest id fetch: ${error.message}`);
    if (!data?.length) break;
    ids.push(...data.map((g) => g.id));
    if (data.length < 1000) break;
  }
  const targets = ids.slice(0, need);
  log('burst', `checking in ${fmtN(targets.length)} distinct guests across ${SCANNERS} scanners`);

  const durations = [];
  let ok = 0, dup = 0, err = 0;
  let cursor = 0;
  async function scanner(n) {
    while (true) {
      const idx = cursor++;
      if (idx >= targets.length) break;
      const gid = targets[idx];
      const t0 = performance.now();
      const { error } = await admin.from('check_ins').insert({ guest_id: gid, checked_by: ADMIN_USER_ID, device_id: `scale-scanner-${n}` });
      durations.push(performance.now() - t0);
      if (!error) ok += 1;
      else if (error.code === '23505') dup += 1;
      else { err += 1; if (err <= 3) log('burst', `insert err: ${error.code} ${error.message}`); }
    }
  }
  const t0 = performance.now();
  await Promise.all(Array.from({ length: SCANNERS }, (_, n) => scanner(n)));
  const elapsed = (performance.now() - t0) / 1000;
  durations.sort((a, b) => a - b);

  console.log(`  inserted        ${fmtN(ok)} ok, ${dup} dup(23505), ${err} err`);
  console.log(`  throughput      ${(ok / elapsed).toFixed(0)} check-ins/sec  (${elapsed.toFixed(1)}s wall)`);
  console.log(`  latency p50     ${percentile(durations, 50).toFixed(1)} ms`);
  console.log(`  latency p95     ${percentile(durations, 95).toFixed(1)} ms`);
  console.log(`  latency p99     ${percentile(durations, 99).toFixed(1)} ms`);
  console.log(`  latency max     ${(durations[durations.length - 1] ?? 0).toFixed(1)} ms`);

  // Correctness: server count of active check-ins == ok.
  const { count } = await admin.from('check_ins').select('id', { count: 'exact', head: true }).eq('event_id', MEGA.event);
  log(count === ok ? 'PASS' : 'WARN', `server check_ins for mega = ${fmtN(count ?? 0)} (burst ok=${fmtN(ok)}); scope trigger filled event_id.`);
  return { throughput: ok / elapsed, p95: percentile(durations, 95) };
}

export async function seedFleet(admin) {
  const { error: vErr } = await admin.from('venues').upsert({ id: FLEET.venue, name: '__scale__ fleet (many events)', slug: 'scale-fleet-venue' }, { onConflict: 'id' });
  if (vErr) throw new Error(`fleet venue: ${vErr.message}`);
  // ADMIN_USER_ID has no relationship to this synthetic venue by default, so the
  // quota-engine trigger (enforced on EVERY insert, service-role included — it's
  // a trigger, not an RLS policy the service client can bypass) treats them as
  // quota=0 and rejects every guest insert with 45001. Admin membership makes
  // them quota-exempt, same as a real admin at a real venue.
  const { error: mErr } = await admin
    .from('venue_memberships')
    .upsert({ venue_id: FLEET.venue, user_id: ADMIN_USER_ID, roles: ['admin'] }, { onConflict: 'venue_id,user_id' });
  if (mErr) throw new Error(`fleet admin membership: ${mErr.message}`);
  // Check how many fleet events already exist (idempotent rerun).
  const { count } = await admin.from('events').select('id', { count: 'exact', head: true }).eq('venue_id', FLEET.venue);
  if ((count ?? 0) >= FLEET.events) { log('fleet', `venue already has ${count} events — skip`); return; }
  for (let e = 0; e < FLEET.events; e++) {
    const eventId = `${FLEET.eventBase}${pad12(e)}`;
    const tierId = `${FLEET.tierBase}${pad12(e)}`;
    const { error: evErr } = await admin.from('events').upsert({
      id: eventId, venue_id: FLEET.venue, name: `__scale__ fleet event ${e}`,
      starts_at: '2026-01-01 22:00:00+01', ends_at: '2026-01-02 05:00:00+01',
      status: 'closed', landing_slug: `scale-fleet-${pad12(e)}`, landing_active: false,
    }, { onConflict: 'id' });
    if (evErr) throw new Error(`fleet event ${e}: ${evErr.message}`);
    const { error: tErr } = await admin
      .from('guest_tiers')
      .upsert({ id: tierId, event_id: eventId, name: 'Fleet', color: '#8A8A93', aliases: [] }, { onConflict: 'id' });
    if (tErr) throw new Error(`fleet tier ${e}: ${tErr.message}`);
    const rows = Array.from({ length: FLEET.guestsPer }, (_, i) => ({
      id: uuidv7(), event_id: eventId, tier_id: tierId, full_name: `Fleet ${e}-${i}`,
      plus_ones: 0, added_by: ADMIN_USER_ID, source: 'app', status: 'approved',
    }));
    const { error: gErr } = await admin.from('guests').insert(rows);
    if (gErr) throw new Error(`fleet guests ${e}: ${gErr.message}`);
    // A handful of events also get a guest_request + quota_request, so the
    // FE-3/SCALE-5-fixed reads that aren't guests/tiers have real rows too.
    if (e < FLEET.withRequests) {
      const { error: rErr } = await admin.from('guest_requests').insert({
        event_id: eventId, full_name: `Fleet Requester ${e}`, phone: '+31600000000',
        plus_ones: 0, motivation: 'fleet test', status: 'pending',
      });
      if (rErr) throw new Error(`fleet guest_request ${e}: ${rErr.message}`);
      const { error: qErr } = await admin
        .from('quota_requests')
        .insert({ event_id: eventId, user_id: ADMIN_USER_ID, requested_extra: 1 });
      if (qErr) throw new Error(`fleet quota_request ${e}: ${qErr.message}`);
    }
    if ((e + 1) % 100 === 0) log('fleet', `seeded ${e + 1}/${FLEET.events} events`);
  }
  log('fleet', `seeded ${FLEET.events} events × ${FLEET.guestsPer} guests on one venue (${FLEET.withRequests} also carry a request/quota-request)`);
}

/**
 * The events-per-venue axis (SCALE-5/K8/FE-3) — now a REGRESSION GUARD. Meters
 * every venue-wide read this fix touched; asserts none 414s and none ships a
 * suspiciously long request URL (the actual bug: an `.in(eventIds)` list growing
 * past Kong's ~8 KB limit). Pre-fix, this would have shown `fetchEventHeadcounts`
 * (and friends) either THROW or carry a multi-KB request URL at 400 events —
 * post-fix every check is a short, fixed-size `venue_id=eq.<uuid>` (or an RPC
 * call), regardless of how many events the venue has.
 */
export async function measureFleet(admin, src) {
  console.log(`\n── FLEET — 1 venue × ${FLEET.events} events (events-per-venue axis, SCALE-5/K8/FE-3) ──`);
  const checks = [
    ['fetchEvents', () => src.fetchEvents(admin, FLEET.venue)],
    ['fetchEventHeadcounts', () => src.fetchEventHeadcounts(admin, FLEET.venue)],
    ['fetchGuests', () => src.fetchGuests(admin, { venueId: FLEET.venue })],
    ['fetchTiers', () => src.fetchTiers(admin, { venueId: FLEET.venue })],
    ['fetchGuestRequests', () => src.fetchGuestRequests(admin, FLEET.venue)],
    ['fetchQuotaRequests', () => src.fetchQuotaRequests(admin, FLEET.venue)],
    ['fetchVenueRequestLinks', () => src.fetchVenueRequestLinks(admin, FLEET.venue)],
  ];

  // What the OLD `.in('event_id', eventIds)` shape would have cost at this fleet
  // size — never actually sent; logged purely as the counterfactual this guards
  // against (mirrors the audit's own measured table: 400 events = 15.8 KB).
  const { data: evs } = await admin.from('events').select('id').eq('venue_id', FLEET.venue).order('id');
  const eventIds = (evs ?? []).map((r) => r.id);
  const wouldBeUriLength = `event_id=in.${encodeURIComponent(`(${eventIds.join(',')})`)}`.length;
  log('fleet', `venue has ${eventIds.length} events; the OLD .in(eventIds) shape would have been ${fmtN(wouldBeUriLength)} bytes (Kong's limit is ~8000).`);

  let anyBroken = false;
  for (const [name, run] of checks) {
    const r = await meter(name, run);
    const size = r.out instanceof Map ? r.out.size : Array.isArray(r.out) ? r.out.length : '?';
    const broken = r.threw != null || r.errors.length > 0;
    if (broken) anyBroken = true;
    console.log(
      `  ${name.padEnd(24)} ${String(Math.round(r.ms)).padStart(6)} ms  ${String(r.requests).padStart(3)} req  ` +
      `${fmtKB(r.bytes).padStart(9)}  url≤${String(r.maxUrl).padStart(5)} chars  ${size} row(s)` +
      (broken ? `  ⚠ ${r.threw ? `THREW: ${r.threw.message ?? r.threw}` : `non-2xx: ${r.errors.join(',')}`}` : ''),
    );
  }
  log(anyBroken ? 'FAIL' : 'PASS', anyBroken
    ? 'at least one venue-wide read failed at 400 events — see ⚠ lines above.'
    : `every venue-wide read completed at ${eventIds.length} events with a short, fixed-size request — no 414 (SCALE-5/K8 fixed).`);
}

export async function teardownFleet(admin) {
  const { data: evs } = await admin.from('events').select('id').eq('venue_id', FLEET.venue);
  const eventIds = (evs ?? []).map((r) => r.id);
  for (const eventId of eventIds) {
    const { data } = await admin.from('guests').select('id').eq('event_id', eventId).not('status', 'eq', 'removed');
    const gids = (data ?? []).map((g) => g.id);
    if (gids.length) await admin.from('guests').update({ status: 'removed' }).in('id', gids);
  }
  log('teardown', `fleet: soft-removed guests on ${eventIds.length} events — shells + venue + requests persist; \`pnpm db:fresh\` fully purges.`);
}

export async function teardown(admin) {
  console.log('\n── TEARDOWN ───────────────────────────────────────────────────');
  await teardownFleet(admin);
  for (const ev of [MEGA, MID]) {
    // Try hard delete (test-only). If revoked, fall back to soft-remove.
    const del = await admin.from('check_ins').delete().eq('event_id', ev.event);
    const gdel = await admin.from('guests').delete().eq('event_id', ev.event);
    if (del.error || gdel.error) {
      log('teardown', `hard delete blocked (${(del.error ?? gdel.error)?.code}) — soft-removing ${ev.slug}`);
      // Soft path: void check-ins, remove guests. Paginate the id fetch (the same
      // 1000-row cap the audit is about) so we get ALL of them, not the first 1000.
      const gids = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await admin.from('guests').select('id').eq('event_id', ev.event).not('status', 'eq', 'removed').order('id').range(from, from + 999);
        if (!data?.length) break;
        gids.push(...data.map((g) => g.id));
        if (data.length < 1000) break;
      }
      for (let i = 0; i < gids.length; i += 500) {
        const chunk = gids.slice(i, i + 500);
        await admin.from('check_ins').update({ voided_at: new Date().toISOString(), voided_by: ADMIN_USER_ID }).in('guest_id', chunk);
        await admin.from('guests').update({ status: 'removed' }).in('id', chunk);
      }
      log('teardown', `${ev.slug}: soft-removed ${fmtN(gids.length)} guests — the __scale__ event shell remains (soft-delete only); \`pnpm db:fresh\` fully purges.`);
    } else {
      await admin.from('guest_tiers').delete().eq('event_id', ev.event);
      await admin.from('events').delete().eq('id', ev.event);
      log('teardown', `${ev.slug}: hard-deleted.`);
    }
  }
}

async function main() {
  if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY required (test-only service client).');
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  let server;
  try {
    if (mode === 'teardown') { await teardown(admin); return; }
    const src = await loadSource();
    server = src.server;
    if (mode === 'seed' || mode === 'all') await seed(admin);
    if (mode === 'measure' || mode === 'all') await measure(admin, src);
    if (mode === 'burst' || mode === 'all') await burst(admin);
    if (mode === 'fleet' || mode === 'all') { await seedFleet(admin); await measureFleet(admin, src); }
    console.log('');
    log('done', `mode=${mode}. Reap with: node scripts/perf/scale-audit.mjs teardown  (or pnpm db:fresh)`);
  } finally {
    if (server) await server.close();
  }
}
// Only auto-run when executed directly (`node scale-audit.mjs …`) — importing
// this module (scale-beforeafter.mjs reuses its seed/measure/burst/teardown
// infra) must not trigger a second run against the shared local DB.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => { console.error(`[scale] FAILED — ${err?.message ?? err}`); process.exitCode = 1; });
}
