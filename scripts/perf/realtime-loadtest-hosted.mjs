// Hosted realtime load-test — schaal-track #3 (g). The meet-fundament for the
// before/after of #3a (postgres_changes -> Broadcast) and the RLS/read fixes.
//
// WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM realtime-burst.mjs
//   realtime-burst.mjs runs LOCAL with the SERVICE-ROLE key, so RLS is bypassed —
//   it proves the eventsPerSecond throttle (#0b) but CANNOT measure the thing that
//   actually breaks at scale: postgres_changes evaluates the table RLS PER
//   SUBSCRIBER PER CHANGE. This harness therefore connects every subscriber as a
//   real AUTHENTICATED user (a venue doorhost) so the Realtime server must run the
//   check_ins SELECT policy for each delivery — the true cost at 500+ orgs. And it
//   runs against a HOSTED throwaway project, because local low-latency != hosted
//   scale (perf-baseline-3.5a caveat).
//
// WHAT IT MEASURES
//   M throwaway venues (≈ orgs), each with 1 live event + guests + 1 doorhost, and
//   SUBS_PER_EVENT authenticated door connections per event. Then it bursts check-
//   ins across all events and reports, per mode: delivery %, dropped, lag p50/p95,
//   total channels, total delivered messages. Run it twice for the headline:
//     MODE=postgres_changes  (baseline — RLS per subscriber per change)
//     MODE=broadcast         (after — authorize once at channel join; see TODO)
//   Pair each run with the hosted dashboard's Database CPU + Realtime metrics
//   (the script prints a reminder + a rough window) — DoD wants acceptable DB-CPU.
//
// SAFETY (hard guards — this writes data + many auth users)
//   * Targets LOADTEST_SUPABASE_URL only (NOT the app's NEXT_PUBLIC_* / prod).
//   * Refuses the known prod ref (tolxwgqhppdcvnogdpel) and localhost outright.
//   * Requires LOADTEST_ALLOW=1 to run, so it can never fire by accident.
//   Use a dedicated throwaway/branch Supabase project with the migrations applied
//   (incl. 20260622120000_checkin_event_scope). Tear the whole project down after.
//
// USAGE
//   LOADTEST_ALLOW=1 \
//   LOADTEST_SUPABASE_URL=https://<throwaway-ref>.supabase.co \
//   LOADTEST_SUPABASE_ANON_KEY=... LOADTEST_SUPABASE_SERVICE_KEY=... \
//   MODE=postgres_changes EVENTS=50 SUBS_PER_EVENT=3 BURST_PER_EVENT=100 \
//     node scripts/perf/realtime-loadtest-hosted.mjs
//
// NOTE: token-minting uses the admin generateLink + verifyOtp path (same idea as
// the dev-login route / scripts/dev-mfa.mjs). Verify the verifyOtp `type` against
// the hosted project's auth version on first run; adjust if it rejects the OTP.

import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

// ── Config ───────────────────────────────────────────────────────────────────
const MODE = process.env.MODE ?? 'postgres_changes'; // 'postgres_changes' | 'broadcast'
const EVENTS = Number(process.env.EVENTS ?? 50); // ≈ concurrent live orgs
const SUBS_PER_EVENT = Number(process.env.SUBS_PER_EVENT ?? 3); // door devices/cockpit per event
const BURST_PER_EVENT = Number(process.env.BURST_PER_EVENT ?? 100); // check-ins/event in the burst
const EVENTS_PER_SECOND = Number(process.env.EVENTS_PER_SECOND ?? 200); // matches the app client
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 10_000);
const SUBSCRIBE_TIMEOUT_MS = 15_000;
const NS = 'ad000000'; // fixed throwaway namespace -> ids ad000000-0000-7000-8000-...

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const percentile = (sorted, p) =>
  sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];

// ── Creds + hard safety guards ───────────────────────────────────────────────
function creds() {
  const url = process.env.LOADTEST_SUPABASE_URL ?? '';
  const anonKey = process.env.LOADTEST_SUPABASE_ANON_KEY ?? '';
  const serviceKey = process.env.LOADTEST_SUPABASE_SERVICE_KEY ?? '';
  if (process.env.LOADTEST_ALLOW !== '1')
    throw new Error('Refusing to run: set LOADTEST_ALLOW=1 to confirm a throwaway target.');
  if (!url || !anonKey || !serviceKey)
    throw new Error('Need LOADTEST_SUPABASE_URL + _ANON_KEY + _SERVICE_KEY (throwaway project).');
  if (url.includes('tolxwgqhppdcvnogdpel'))
    throw new Error('Refusing: that is the PROD project ref. Use a throwaway project.');
  if (url.includes('127.0.0.1') || url.includes('localhost'))
    throw new Error('Refusing localhost — use scripts/perf/realtime-burst.mjs for the local stack.');
  return { url, anonKey, serviceKey };
}

// ── Authenticated token for a user (admin generateLink -> verifyOtp) ──────────
async function mintToken(admin, url, anonKey, email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  const otp = data?.properties?.email_otp;
  if (!otp) throw new Error(`no email_otp for ${email}`);
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // type:'magiclink' matches a magiclink-generated OTP; if the hosted auth version
  // rejects it, try type:'email' (both are documented for email OTPs).
  const { data: sess, error: vErr } = await userClient.auth.verifyOtp({
    email,
    token: otp,
    type: 'magiclink',
  });
  if (vErr || !sess?.session) throw new Error(`verifyOtp ${email}: ${vErr?.message ?? 'no session'}`);
  return sess.session.access_token;
}

// ── Idempotent throwaway scaffold: M venues, each event+tier+doorhost+guests ──
async function ensureScaffold(admin, url, anonKey) {
  const orgs = [];
  for (let v = 0; v < EVENTS; v++) {
    const venueId = `${NS}-0000-7000-8000-${String(v).padStart(12, '0')}`;
    const eventId = `${NS}-0001-7000-8000-${String(v).padStart(12, '0')}`;
    const tierId = `${NS}-0002-7000-8000-${String(v).padStart(12, '0')}`;
    const email = `loadtest-door-${v}@plusone-loadtest.test`;

    let { error } = await admin.from('venues').upsert({ id: venueId, name: `zzz-loadtest venue ${v}` }, { onConflict: 'id' });
    if (error) throw new Error(`venue ${v}: ${error.message}`);

    // Doorhost user (idempotent: ignore "already registered").
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    let userId = created?.user?.id;
    if (cErr && !/already/i.test(cErr.message)) throw new Error(`createUser ${email}: ${cErr.message}`);
    if (!userId) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1, email });
      userId = list?.users?.[0]?.id;
    }
    if (!userId) throw new Error(`no user id for ${email}`);

    // user_profiles + venue_membership(doorhost) so RLS grants check_ins SELECT.
    await admin.from('user_profiles').upsert({ id: userId, full_name: `Loadtest Door ${v}` }, { onConflict: 'id' });
    await admin.from('venue_memberships').upsert(
      { venue_id: venueId, user_id: userId, roles: ['doorhost'] },
      { onConflict: 'venue_id,user_id' },
    );

    ({ error } = await admin.from('events').upsert(
      { id: eventId, venue_id: venueId, name: `zzz-loadtest event ${v}`, starts_at: new Date().toISOString(), status: 'live', landing_slug: `zzz-loadtest-${NS}-${v}` },
      { onConflict: 'id' },
    ));
    if (error) throw new Error(`event ${v}: ${error.message}`);
    await admin.from('guest_tiers').upsert({ id: tierId, event_id: eventId, name: 'Loadtest' }, { onConflict: 'id' });

    // Fresh guests for this burst (check_ins.guest_id is unique).
    const guestIds = Array.from({ length: BURST_PER_EVENT }, () => uuidv7());
    const guests = guestIds.map((id, i) => ({
      id, event_id: eventId, tier_id: tierId, full_name: `Loadtest Guest ${v}-${i}`, added_by: userId, status: 'approved',
    }));
    for (let i = 0; i < guests.length; i += 500) {
      const { error: gErr } = await admin.from('guests').insert(guests.slice(i, i + 500));
      if (gErr) throw new Error(`guests ${v} chunk ${i}: ${gErr.message}`);
    }

    const token = await mintToken(admin, url, anonKey, email);
    orgs.push({ venueId, eventId, tierId, userId, token, guestIds });
    if ((v + 1) % 10 === 0) console.log(`  scaffolded ${v + 1}/${EVENTS} orgs…`);
  }
  return orgs;
}

// ── One authenticated subscriber on one event (RLS runs per delivery) ─────────
function makeSubscriber(url, anonKey, token, eventId, label, wantedGuestIds) {
  const client = createClient(url, anonKey, {
    realtime: { params: { eventsPerSecond: EVENTS_PER_SECOND } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client.realtime.setAuth(token); // the JWT the Realtime server evaluates RLS with
  const wanted = new Set(wantedGuestIds);
  const seen = new Set();
  const sentAt = new Map();
  const lags = [];

  let channel = client.channel(MODE === 'broadcast' ? `event:${eventId}` : `loadtest:${eventId}:${label}`,
    MODE === 'broadcast' ? { config: { private: true } } : undefined);

  if (MODE === 'broadcast') {
    // AFTER: requires the DB broadcast trigger on check_ins -> topic event:{id}
    // and an RLS policy on realtime.messages (the #3a Broadcast step). TODO: wire
    // when that lands; until then this mode reports 0 and the baseline is the run.
    channel = channel.on('broadcast', { event: 'check_in' }, (msg) => {
      const gid = msg?.payload?.guest_id;
      if (!gid || !wanted.has(gid) || seen.has(gid)) return;
      seen.add(gid);
      const t = sentAt.get(gid);
      if (t != null) lags.push(Date.now() - t);
    });
  } else {
    channel = channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `event_id=eq.${eventId}` },
      (payload) => {
        const gid = payload.new?.guest_id;
        if (!gid || !wanted.has(gid) || seen.has(gid)) return;
        seen.add(gid);
        const t = sentAt.get(gid);
        if (t != null) lags.push(Date.now() - t);
      },
    );
  }

  return {
    markSent: (gid) => sentAt.set(gid, Date.now()),
    subscribe: () =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label}: subscribe timeout`)), SUBSCRIBE_TIMEOUT_MS);
        channel.subscribe((st) => {
          if (st === 'SUBSCRIBED') { clearTimeout(timer); resolve(); }
          else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(`${label}: ${st}`)); }
        });
      }),
    stats: () => ({ received: seen.size, lags: [...lags] }),
    teardown: async () => { try { await client.removeChannel(channel); } catch { /* best effort */ } },
  };
}

// ── Burst: BURST_PER_EVENT check-ins for every event, via service-role ────────
async function burst(admin, orgs, subsByEvent) {
  const t0 = Date.now();
  const CONCURRENCY = 64;
  const jobs = orgs.flatMap((o) => o.guestIds.map((gid) => ({ o, gid })));
  let cursor = 0;
  async function worker() {
    while (cursor < jobs.length) {
      const { o, gid } = jobs[cursor++];
      for (const s of subsByEvent.get(o.eventId) ?? []) s.markSent(gid);
      const { error } = await admin.from('check_ins').insert({ guest_id: gid, checked_by: o.userId, device_id: 'loadtest' });
      if (error && cursor % 200 === 0) console.warn(`  insert err @${cursor}: ${error.message}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const elapsed = (Date.now() - t0) / 1000;
  return { elapsed, total: jobs.length, rate: jobs.length / elapsed };
}

// ── Soft teardown (#3 forbids hard delete): void check-ins + remove guests ────
async function softTeardown(admin, orgs) {
  for (const o of orgs) {
    for (let i = 0; i < o.guestIds.length; i += 100) {
      const chunk = o.guestIds.slice(i, i + 100);
      await admin.from('check_ins').update({ voided_at: new Date().toISOString(), voided_by: o.userId }).in('guest_id', chunk);
      await admin.from('guests').update({ status: 'removed' }).in('id', chunk);
    }
  }
  console.log('  (venues/events/users persist in the zzz-loadtest namespace — drop the whole throwaway project to fully clean up.)');
}

async function main() {
  const { url, anonKey, serviceKey } = creds();
  const totalSubs = EVENTS * SUBS_PER_EVENT;
  const totalBurst = EVENTS * BURST_PER_EVENT;
  console.log(`hosted load-test — MODE=${MODE}`);
  console.log(`target: ${url}`);
  console.log(`scale: ${EVENTS} events × ${SUBS_PER_EVENT} subs = ${totalSubs} authenticated channels; burst ${totalBurst} check-ins\n`);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let orgs = [];
  const allSubs = [];
  const subsByEvent = new Map();
  try {
    console.log(`• scaffolding ${EVENTS} throwaway orgs (venue+event+doorhost+${BURST_PER_EVENT} guests each)…`);
    orgs = await ensureScaffold(admin, url, anonKey);

    console.log(`• opening ${totalSubs} authenticated subscribers…`);
    for (const o of orgs) {
      const list = [];
      for (let s = 0; s < SUBS_PER_EVENT; s++) {
        const sub = makeSubscriber(url, anonKey, o.token, o.eventId, `${o.eventId.slice(-4)}#${s}`, o.guestIds);
        list.push(sub);
        allSubs.push(sub);
      }
      subsByEvent.set(o.eventId, list);
    }
    await Promise.all(allSubs.map((s) => s.subscribe()));
    await sleep(1_000);

    const startedAt = new Date().toISOString();
    console.log(`• bursting ${totalBurst} check-ins across ${EVENTS} events…`);
    const { elapsed, total, rate } = await burst(admin, orgs, subsByEvent);
    console.log(`  inserted ${total} in ${elapsed.toFixed(2)}s (${rate.toFixed(0)}/sec)`);

    console.log(`• settling ${SETTLE_MS}ms…`);
    await sleep(SETTLE_MS);

    const received = allSubs.reduce((n, s) => n + s.stats().received, 0);
    const expected = orgs.reduce((n, o) => n + (subsByEvent.get(o.eventId)?.length ?? 0) * o.guestIds.length, 0);
    const lags = allSubs.flatMap((s) => s.stats().lags).sort((a, b) => a - b);
    console.log('\n── result ─────────────────────────────────────────────');
    console.log(`mode              ${MODE}`);
    console.log(`channels          ${totalSubs} (authenticated)`);
    console.log(`delivered         ${received}/${expected} (${((received / expected) * 100).toFixed(1)}%)`);
    console.log(`dropped           ${expected - received}`);
    console.log(`lag p50 / p95     ${percentile(lags, 50) ?? '—'}ms / ${percentile(lags, 95) ?? '—'}ms`);
    console.log(`burst window      ${startedAt} … ${new Date().toISOString()}`);
    console.log('───────────────────────────────────────────────────────');
    console.log('NOW: read the hosted dashboard for that window → Database CPU%, Realtime');
    console.log('     concurrent connections, and messages/sec. DoD = acceptable DB-CPU at');
    console.log('     target concurrency. Re-run with MODE=broadcast for the after-figure.');
    if (MODE === 'broadcast' && received === 0)
      console.log('\n(broadcast delivered 0 — the DB broadcast trigger + realtime.messages policy is not wired yet; that is the #3a Broadcast step.)');
  } finally {
    console.log('\n• soft teardown (void check-ins + remove guests)…');
    if (orgs.length) await softTeardown(admin, orgs);
    for (const s of allSubs) await s.teardown();
    await sleep(300);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
