#!/usr/bin/env node
// Real-connection concurrency test for the last-admin guard
// (20261012120000_last_admin_guard.sql, trigger refuse_last_admin_removal;
// onboarding task 0g).
//
// WHY THIS ISN'T A pgTAP FILE: two admins removing each other at the same
// moment needs two independently committing sessions; one pgTAP file is one
// transaction on one connection (see scripts/quota-trigger-concurrency-test.mjs
// for the full why, dblink included).
//
// WHAT IT PROVES
//   A company with exactly two admins (A and B). Session 1 removes A (or
//   demotes A) and holds its transaction open; session 2 removes B. Without a
//   lock both would count "one other admin" and both succeed: zero admins.
//   We poll pg_locks until session 2 is genuinely WAITING on the advisory lock,
//   commit session 1, and require session 2 to fail with P0LA1 (READ
//   COMMITTED, what PostgREST uses) or 40001 (REPEATABLE READ, where the
//   trigger's FOR UPDATE turns the stale snapshot into a serialization
//   failure). Afterwards the company must still have exactly one admin.
//
// RESIDUE: fixtures are permanent (audit_log rows reference the venue with
// ON DELETE RESTRICT, by design) and named "🧪 last-admin-concurrency".
// Loopback-only unless ALLOW_REMOTE_PGURL=1, same as the quota script.
//
// USAGE
//   node scripts/last-admin-concurrency-test.mjs

import pg from 'pg';
import { randomUUID } from 'node:crypto';

const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
{
  const host = new URL(PGURL).hostname;
  if (!LOOPBACK_HOSTS.has(host) && process.env.ALLOW_REMOTE_PGURL !== '1') {
    console.error(
      `Refusing to run against non-local PGURL host "${host}" — this script commits permanent test ` +
        'fixtures (see header). Set ALLOW_REMOTE_PGURL=1 if you really mean a remote/hosted database.'
    );
    process.exit(1);
  }
}

// Seed users (supabase/seed.sql): any two existing profiles will do — the
// fresh venue below is theirs only.
const ADA = '55555555-5555-4555-8555-555555555555';
const BO = '66666666-6666-4666-8666-666666666666';

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

async function makeVenue(setup) {
  const slug = `last-admin-concurrency-${randomUUID()}`;
  const { rows } = await setup.query(
    `insert into public.venues (name, slug) values ('🧪 last-admin-concurrency', $1) returning id`,
    [slug]
  );
  const venueId = rows[0].id;
  await setup.query(
    `insert into public.venue_memberships (venue_id, user_id, roles) values ($1, $2, '{admin}'), ($1, $3, '{admin}')`,
    [venueId, ADA, BO]
  );
  return venueId;
}

async function waitUntilBlockedOnAdvisoryLock(observer, targetPid, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await observer.query(
      `select 1 from pg_locks where pid = $1 and locktype = 'advisory' and not granted limit 1`,
      [targetPid]
    );
    if (rows.length > 0) return true;
    await sleep(intervalMs);
  }
  return false;
}

async function race({ label, setup, observer, firstSql, isolation, expected }) {
  console.log(`\n${label}`);
  const venueId = await makeVenue(setup);
  const conn1 = await connect();
  const conn2 = await connect();
  try {
    await conn2.query(`begin isolation level ${isolation}`);
    // Take session 2's snapshot BEFORE session 1 acts (matters for REPEATABLE READ).
    await conn2.query('select count(*) from public.venue_memberships where venue_id = $1', [venueId]);

    await conn1.query('begin');
    await conn1.query(firstSql, [venueId, ADA]); // holds the venue's advisory lock

    const { rows: pidRows } = await conn2.query('select pg_backend_pid() as pid');
    const pid2 = pidRows[0].pid;
    const second = conn2
      .query('delete from public.venue_memberships where venue_id = $1 and user_id = $2', [venueId, BO])
      .catch((err) => err);

    assertion(
      await waitUntilBlockedOnAdvisoryLock(observer, pid2),
      'session 2 is genuinely waiting on the advisory lock while session 1 is open'
    );
    await conn1.query('commit');

    const result = await second;
    if (!(result instanceof Error)) {
      failures += 1;
      console.error('  FAIL — session 2 SUCCEEDED: the company would be left without an admin');
    } else {
      assertion(expected.includes(result.code), `session 2 is refused with ${expected.join(' or ')} (got ${result.code})`);
    }
  } finally {
    await conn2.query('rollback').catch(() => {});
    await conn1.end();
    await conn2.end();
  }

  const { rows } = await setup.query(
    `select count(*)::int as n from public.venue_memberships where venue_id = $1 and 'admin' = any (roles)`,
    [venueId]
  );
  assertion(rows[0].n === 1, `the company still has exactly one admin (got ${rows[0].n})`);
}

const setup = await connect();
const observer = await connect();
try {
  const DELETE_FIRST = 'delete from public.venue_memberships where venue_id = $1 and user_id = $2';
  const DEMOTE_FIRST = `update public.venue_memberships set roles = '{staff}' where venue_id = $1 and user_id = $2`;
  await race({
    label: 'Two admins remove each other (READ COMMITTED, the PostgREST default)',
    setup, observer, firstSql: DELETE_FIRST, isolation: 'read committed', expected: ['P0LA1'],
  });
  await race({
    label: 'One demotes, the other removes (READ COMMITTED)',
    setup, observer, firstSql: DEMOTE_FIRST, isolation: 'read committed', expected: ['P0LA1'],
  });
  await race({
    label: 'Two admins remove each other, session 2 on REPEATABLE READ (stale snapshot)',
    setup, observer, firstSql: DELETE_FIRST, isolation: 'repeatable read', expected: ['40001', 'P0LA1'],
  });
} finally {
  await setup.end();
  await observer.end();
}

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nAll last-admin concurrency assertions passed.');
