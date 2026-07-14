#!/usr/bin/env node
// Real-connection concurrency test for the quota/capacity/tier-max trigger
// locking fix (ClickUp 86ey9e8ar).
//
// WHY THIS ISN'T A pgTAP FILE
//   Proving "two concurrent transactions on the boundary — exactly one must
//   fail" needs two genuinely separate, independently-committing Postgres
//   sessions racing each other. A pgTAP file runs as ONE script over ONE
//   connection/transaction (every file in supabase/tests/database wraps
//   itself in begin/rollback for exactly that reason) — a single session
//   cannot hold two overlapping transactions open at once. dblink would give
//   a second connection from inside SQL, but this project's local/CI
//   Supabase image runs migrations and pgTAP as the `postgres` role, which is
//   deliberately NOT a superuser here: dblink_connect() refuses non-superuser
//   callers unless real password auth is configured (local trust auth isn't),
//   and dblink_connect_u()'s EXECUTE grant belongs to `supabase_admin`, which
//   `postgres` can neither self-grant nor SET ROLE into. So the race is
//   driven from Node instead, with two direct `pg` connections to the same
//   local/CI Postgres — the same idea scripts/perf/realtime-loadtest-hosted.mjs
//   uses for concurrency this project's SQL-only test tooling can't reach.
//
// WHAT IT PROVES, PER DOMAIN (personal quota / tier max / event capacity)
//   Session A opens a transaction, inserts the one guest that exactly fills
//   the boundary, and DELIBERATELY holds the transaction open (no commit
//   yet) — the trigger's advisory lock stays held for as long as A stays
//   open. Session B is fired at the same boundary and is asserted to still be
//   IN FLIGHT (blocked on A's lock) while A is open — that is the actual
//   proof of serialisation, not just "B happened to run after A". Only once
//   A commits does B unblock, re-read the now-committed count, and correctly
//   get rejected for going one over the boundary.
//
// RESIDUE (read before pointing this at a database you care about)
//   Every fixture this script creates is permanent: the audit_log rows the
//   audit triggers (#4) generate reference the event/guests with
//   ON DELETE RESTRICT, so a fresh event this script creates can never be
//   hard-deleted again — by design (CLAUDE.md "Soft delete only"). This
//   script therefore does NOT attempt cleanup. Fixtures are named
//   "🧪 concurrency-test" so they read as obvious test data. Safe against
//   local dev / CI's throwaway Postgres (both get wiped by the next
//   `supabase db reset`) — NEVER point PGURL at prod or a shared database.
//
// USAGE
//   node scripts/quota-trigger-concurrency-test.mjs
//   PGURL=postgresql://postgres:postgres@127.0.0.1:55322/postgres \
//     node scripts/quota-trigger-concurrency-test.mjs

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
// Seed venue "Club Vesper" — Tom (staff) and Lisa (doorhost+staff) are both
// members (supabase/seed.sql), so guests they add satisfy the guests FK/scope
// triggers without any extra fixture setup.
const VENUE_ID = 'aa000000-0000-7000-8000-000000000001';
const TOM = '55555555-5555-4555-8555-555555555555';
const LISA = '66666666-6666-4666-8666-666666666666';
const UNLIMITED_QUOTA = 999999;

let failures = 0;
function assertion(cond, message) {
  if (cond) {
    console.log(`  ok — ${message}`);
  } else {
    failures += 1;
    console.error(`  FAIL — ${message}`);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connect() {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  return client;
}

// One fresh event (+ one tier) per domain, so each race starts from a clean
// boundary with nothing left over from a previous round to interfere.
async function makeEvent(setup, { capacity = null, tierMax = null } = {}) {
  const slug = `concurrency-test-${randomUUID()}`;
  const { rows: eventRows } = await setup.query(
    `insert into public.events (venue_id, name, starts_at, landing_slug, default_member_quota, capacity)
     values ($1, $2, now() + interval '1 day', $3, 0, $4)
     returning id`,
    [VENUE_ID, '🧪 concurrency-test', slug, capacity]
  );
  const eventId = eventRows[0].id;
  const { rows: tierRows } = await setup.query(
    `insert into public.guest_tiers (event_id, name, max_guests)
     values ($1, 'Concurrency test tier', $2)
     returning id`,
    [eventId, tierMax]
  );
  return { eventId, tierId: tierRows[0].id };
}

async function setQuotaOverride(setup, eventId, userId, quota) {
  await setup.query(
    `insert into public.event_quotas (event_id, user_id, quota_override)
     values ($1, $2, $3)
     on conflict (event_id, user_id) do update set quota_override = excluded.quota_override`,
    [eventId, userId, quota]
  );
}

// Runs the actual race: A inserts + holds its transaction open (so it keeps
// the advisory lock), B is fired concurrently and MUST still be in flight
// while A is open, then A releases and B is expected to resolve to a specific
// error once it re-reads the now-committed boundary.
async function race({ label, insertA, insertB, expectedSqlstate }) {
  console.log(`\n${label}`);
  const connA = await connect();
  const connB = await connect();

  try {
    await connA.query('begin');
    await connA.query(insertA); // succeeds; the trigger's advisory lock is now held, uncommitted

    await connB.query('begin');
    const bPromise = connB.query(insertB).catch((err) => err);

    // Give B time to actually reach the trigger and start blocking on A's lock.
    await sleep(250);
    const bStillInFlight = await Promise.race([
      bPromise.then(() => false),
      sleep(100).then(() => true),
    ]);
    assertion(bStillInFlight, 'B is still blocked on the advisory lock while A is open (real serialisation, not luck)');

    await connA.query('commit');

    const bResult = await bPromise;
    const bErrored = bResult instanceof Error;
    assertion(bErrored, 'B is rejected once it re-reads the boundary A just committed');
    if (bErrored) {
      assertion(
        bResult.code === expectedSqlstate,
        `B fails with the expected SQLSTATE ${expectedSqlstate} (got ${bResult.code})`
      );
    } else {
      failures += 1;
      console.error(`  FAIL — B unexpectedly SUCCEEDED — the boundary was silently exceeded (the exact bug 86ey9e8ar describes)`);
    }
  } finally {
    // B's transaction is either already aborted (it raised) or, in the
    // unexpected case it succeeded, we still don't want to permanently commit
    // a second over-the-boundary guest — roll it back either way.
    await connB.query('rollback').catch(() => {});
    await connA.end();
    await connB.end();
  }
}

async function runQuotaDomain(setup) {
  const { eventId, tierId } = await makeEvent(setup, { capacity: null, tierMax: null });
  await setQuotaOverride(setup, eventId, TOM, 1);

  const insertGuest = (name) => `
    insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
    values ('${eventId}', '${tierId}', '${name}', 0, '${TOM}', 'app')
  `;

  await race({
    label: 'Personal quota (45001) — quota=1, two concurrent adds by the SAME staffer',
    insertA: insertGuest('Race Guest A'),
    insertB: insertGuest('Race Guest B'),
    expectedSqlstate: '45001',
  });

  const { rows } = await setup.query(
    `select count(*)::int as n from public.guests where event_id = $1 and status <> 'removed'`,
    [eventId]
  );
  assertion(rows[0].n === 1, `exactly 1 guest landed for this event (found ${rows[0].n})`);
}

async function runTierMaxDomain(setup) {
  const { eventId, tierId } = await makeEvent(setup, { capacity: null, tierMax: 1 });
  await setQuotaOverride(setup, eventId, TOM, UNLIMITED_QUOTA);
  await setQuotaOverride(setup, eventId, LISA, UNLIMITED_QUOTA);

  const insertGuest = (name, addedBy) => `
    insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
    values ('${eventId}', '${tierId}', '${name}', 0, '${addedBy}', 'app')
  `;

  await race({
    label: 'Tier max (45002) — tier max_guests=1, two DIFFERENT staffers race the same tier',
    insertA: insertGuest('Race Guest A', TOM),
    insertB: insertGuest('Race Guest B', LISA),
    expectedSqlstate: '45002',
  });

  const { rows } = await setup.query(
    `select count(*)::int as n from public.guests where tier_id = $1 and status <> 'removed'`,
    [tierId]
  );
  assertion(rows[0].n === 1, `exactly 1 guest landed in this tier (found ${rows[0].n})`);
}

async function runCapacityDomain(setup) {
  const { eventId, tierId } = await makeEvent(setup, { capacity: 1, tierMax: null });
  await setQuotaOverride(setup, eventId, TOM, UNLIMITED_QUOTA);
  await setQuotaOverride(setup, eventId, LISA, UNLIMITED_QUOTA);

  const insertGuest = (name, addedBy) => `
    insert into public.guests (event_id, tier_id, full_name, plus_ones, added_by, source)
    values ('${eventId}', '${tierId}', '${name}', 0, '${addedBy}', 'app')
  `;

  await race({
    label: 'Event capacity (45005) — capacity=1, two DIFFERENT staffers race the whole room',
    insertA: insertGuest('Race Guest A', TOM),
    insertB: insertGuest('Race Guest B', LISA),
    expectedSqlstate: '45005',
  });

  const { rows } = await setup.query(
    `select count(*)::int as n from public.guests where event_id = $1 and status <> 'removed'`,
    [eventId]
  );
  assertion(rows[0].n === 1, `exactly 1 guest landed for this event (found ${rows[0].n})`);
}

async function main() {
  const setup = await connect();
  try {
    await runQuotaDomain(setup);
    await runTierMaxDomain(setup);
    await runCapacityDomain(setup);
  } finally {
    await setup.end();
  }

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} assertion(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Concurrency test crashed:', err);
  process.exit(1);
});
