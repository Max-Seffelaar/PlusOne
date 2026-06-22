/**
 * Integration check for the ranged-paging fix (#0a).
 *
 * Proves that `fetchDoorSnapshot` and `fetchPoGuests` return ALL guests of an
 * event even past PostgREST's 1000-row cap — the pre-fix single-`.select()` code
 * would have returned exactly 1000 and silently dropped the rest at the door.
 *
 * ── DO NOT run this in the build phase. ────────────────────────────────────────
 * It needs DB access and writes ~1100 throwaway guests. The orchestrator runs it
 * SERIALIZED against the shared local stack (no other session resetting the DB),
 * then it tears its own data down. It is NOT part of `pnpm test`.
 *
 * Usage (orchestrator):
 *   SUPABASE_SERVICE_ROLE_KEY=… NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321 \
 *     node scripts/perf/range-check.mjs
 *
 * It imports the REAL source functions (not a copy) via Vite's SSR module loader,
 * which resolves the `@/…` alias and the nested TS imports exactly like Vitest.
 *
 * Security note: this is the ONE place a service-role key is acceptable — it's a
 * test-only script, never shipped, and it needs to bypass RLS to seed + reap a
 * throwaway event quickly. App code never does this.
 */
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { v7 as uuidv7 } from 'uuid';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Seed constants (supabase/seed.sql): Club Vesper + the admin profile. We hang a
// THROWAWAY event off this existing venue rather than touching the seed event.
const VENUE_ID = 'aa000000-0000-7000-8000-000000000001';
const ADMIN_USER_ID = '11111111-1111-4111-8111-111111111111';

const GUEST_COUNT = 1100; // > 1000 so the cap would bite without paging.

function log(step, msg) {
  console.log(`[range-check] ${step.padEnd(8)} ${msg}`);
}

async function loadSource() {
  // Vite SSR-loads the TS source with the same `@` alias as vitest.config.ts, so
  // we exercise the shipping functions (incl. src/lib/supabase/paging.ts) directly.
  const server = await createServer({
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false },
    resolve: {
      alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    },
  });
  try {
    const door = await server.ssrLoadModule('@/features/door/queries.ts');
    const po = await server.ssrLoadModule('@/features/po/queries.ts');
    return { fetchDoorSnapshot: door.fetchDoorSnapshot, fetchPoGuests: po.fetchPoGuests, server };
  } catch (err) {
    await server.close();
    throw err;
  }
}

async function main() {
  if (!SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required (test-only service client).');
  }

  const { fetchDoorSnapshot, fetchPoGuests, server } = await loadSource();
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventId = uuidv7();
  const tierId = uuidv7();
  let inserted = 0;

  try {
    log('setup', `creating throwaway event ${eventId} on venue ${VENUE_ID}`);
    {
      const { error } = await admin.from('events').insert({
        id: eventId,
        venue_id: VENUE_ID,
        name: `__range_check__ ${new Date().toISOString()}`,
        starts_at: '2026-01-01 22:00:00+01',
        ends_at: '2026-01-02 05:00:00+01',
        status: 'open',
        // Unique slug so reruns don't collide on the slug constraint.
        landing_slug: `range-check-${eventId.slice(0, 8)}`,
        landing_active: false,
      });
      if (error) throw new Error(`event insert failed: ${error.message}`);
    }

    {
      const { error } = await admin.from('guest_tiers').insert({
        id: tierId,
        event_id: eventId,
        name: 'RangeCheck',
        color: '#8A8A93',
        aliases: [],
      });
      if (error) throw new Error(`tier insert failed: ${error.message}`);
    }

    log('seed', `inserting ${GUEST_COUNT} guests (batched)…`);
    const BATCH = 500;
    for (let start = 0; start < GUEST_COUNT; start += BATCH) {
      const rows = [];
      for (let i = start; i < Math.min(start + BATCH, GUEST_COUNT); i++) {
        rows.push({
          id: uuidv7(),
          event_id: eventId,
          tier_id: tierId,
          full_name: `Range Guest ${String(i).padStart(4, '0')}`,
          plus_ones: 0,
          added_by: ADMIN_USER_ID,
          source: 'app',
          status: 'approved',
        });
      }
      const { error } = await admin.from('guests').insert(rows);
      if (error) throw new Error(`guest batch insert failed at ${start}: ${error.message}`);
      inserted += rows.length;
    }
    log('seed', `inserted ${inserted} guests`);

    // The source functions take a USER-scoped client in the app; here the service
    // client stands in (RLS bypass is fine for a test) — what we're verifying is
    // the PAGING, which is independent of which key issues the requests.
    const snapshot = await fetchDoorSnapshot(admin, eventId);
    log('assert', `fetchDoorSnapshot → ${snapshot.guests.length} guests`);
    if (snapshot.guests.length !== GUEST_COUNT) {
      throw new Error(
        `fetchDoorSnapshot returned ${snapshot.guests.length}, expected ${GUEST_COUNT} ` +
          '(pre-fix code truncates at 1000 — the bug).',
      );
    }

    const poGuests = await fetchPoGuests(admin, eventId);
    log('assert', `fetchPoGuests → ${poGuests.length} guests`);
    if (poGuests.length !== GUEST_COUNT) {
      throw new Error(
        `fetchPoGuests returned ${poGuests.length}, expected ${GUEST_COUNT} (truncation bug).`,
      );
    }

    log('ok', `PASS — both reads returned all ${GUEST_COUNT} guests past the 1000-row cap.`);
  } finally {
    // Teardown ALWAYS runs. Hard-delete only the rows this script created (a
    // throwaway event), leaving the seed baseline intact. Order: check_ins (none
    // here, but be safe) → guests → tier → event.
    log('teardown', 'removing throwaway data…');
    try {
      const { data: guestIds } = await admin.from('guests').select('id').eq('event_id', eventId);
      const ids = (guestIds ?? []).map((g) => g.id);
      // Chunk the delete filter to stay under URI limits at 1100 ids.
      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        if (chunk.length) await admin.from('check_ins').delete().in('guest_id', chunk);
      }
      await admin.from('guests').delete().eq('event_id', eventId);
      await admin.from('guest_tiers').delete().eq('event_id', eventId);
      await admin.from('events').delete().eq('id', eventId);
      log('teardown', 'done.');
    } catch (cleanupErr) {
      log('teardown', `WARNING — cleanup failed: ${cleanupErr?.message ?? cleanupErr}`);
    } finally {
      await server.close();
    }
  }
}

main().catch((err) => {
  console.error(`[range-check] FAILED — ${err?.message ?? err}`);
  process.exitCode = 1;
});
