/**
 * Snelheid P2 finding 10 — what the desktop event-day cockpit downloads while
 * a colleague's door checks people in. LOCAL STACK ONLY.
 *
 * Instrument (identical for both sides): a real Chromium at 1280×900 (mouse,
 * so the Deur tab is the cockpit) signed in as admin@ on a fresh live Club
 * Vesper event with 40 guests. After the cockpit has settled, a "peer" checks
 * in 20 guests through the service role, one every 500 ms (2 per second, the
 * audit's door-rush rate); we count every PostgREST request the page sends from
 * the first check-in until 6 s after the last, and check the cockpit shows all
 * 20 inside at the end.
 *
 * Run it once against a dev server on origin/main (before) and once on this
 * branch (after):
 *   node --env-file=.env.local scripts/perf/p2-measure-cockpit.mjs http://localhost:7000
 */
import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const BASE = process.argv[2] ?? 'http://localhost:7000';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const ADMIN = 'admin@plusone.test';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const GUESTS = 40;
const CHECKINS = 20;
const GAP_MS = 500;
const TAIL_MS = 6_000;
const TERMS_VERSION = /TERMS_VERSION = '([^']+)'/.exec(readFileSync(new URL('../../src/lib/legal.ts', import.meta.url), 'utf8'))?.[1];

if (!/127\.0\.0\.1|localhost/.test(SUPABASE_URL)) throw new Error('local stack only');
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (what, { error }) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

async function fixture() {
  must('consent', await db.from('user_profiles').update({ terms_accepted_at: new Date(0).toISOString(), terms_version: TERMS_VERSION, mfa_snooze_until: 'infinity' }).eq('id', ADMIN_ID));
  const eventId = randomUUID();
  const tierId = randomUUID();
  const now = Date.now();
  must('event', await db.from('events').insert({
    id: eventId, venue_id: VENUE, name: `Cockpit Measure ${new Date(now).toISOString().slice(11, 19)}`,
    landing_slug: `cockpit-measure-${eventId.slice(0, 8)}`, status: 'open',
    starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 5 * 3600_000).toISOString(),
  }));
  must('tier', await db.from('guest_tiers').insert({ id: tierId, event_id: eventId, name: 'Regular', color: '#8A8A93', aliases: [] }));
  const guests = Array.from({ length: GUESTS }, (_, i) => ({
    id: randomUUID(), event_id: eventId, tier_id: tierId, full_name: `Cockpit Guest ${String(i + 1).padStart(2, '0')}`,
    plus_ones: 0, added_by: ADMIN_ID, source: 'app', status: 'approved',
  }));
  must('guests', await db.from('guests').insert(guests));
  return { eventId, guests };
}

async function main() {
  const { eventId, guests } = await fixture();
  const browser = await chromium.launch(process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {});
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, url: BASE }]);
  const page = await context.newPage();

  let counting = false;
  const reqs = [];
  page.on('request', (r) => {
    if (counting && r.url().includes('/rest/v1/')) reqs.push(new URL(r.url()).pathname.replace('/rest/v1/', ''));
  });

  await page.goto(`${BASE}/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=${encodeURIComponent(`/app/door?event=${eventId}`)}`);
  await page.getByText(/Cockpit Guest \d+/).first().waitFor({ timeout: 60_000 }).catch(async (e) => {
    await page.screenshot({ path: process.env.P2_SHOT ?? 'cockpit-measure-failure.png' });
    throw e;
  });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3_000);

  counting = true;
  const t0 = Date.now();
  for (const g of guests.slice(0, CHECKINS)) {
    must('check-in', await db.from('check_ins').insert({ guest_id: g.id, event_id: eventId, checked_by: ADMIN_ID, plus_ones_arrived: 0 }));
    await page.waitForTimeout(GAP_MS);
  }
  await page.waitForTimeout(TAIL_MS);
  counting = false;
  const seconds = (Date.now() - t0) / 1000;
  // Correctness, not just cost: the cockpit must show every check-in.
  const shown = await page.getByText(`${CHECKINS} / ${GUESTS} people`).first().isVisible();

  const byPath = {};
  for (const p of reqs) byPath[p] = (byPath[p] ?? 0) + 1;
  const guestsReads = byPath.guests ?? 0;
  console.log(`| Cockpit, ${CHECKINS} peer check-ins in ${(CHECKINS * GAP_MS) / 1000} s (+${TAIL_MS / 1000} s tail) | ${reqs.length} requests | ${(reqs.length / seconds).toFixed(1)} req/s | full guest-list reads: ${guestsReads} | shows ${CHECKINS}/${GUESTS} inside: ${shown ? 'yes' : 'NO'} |`);
  console.log(JSON.stringify(byPath));
  await browser.close();
}

main().catch((err) => {
  console.error(`[p2-measure-cockpit] FAILED: ${err.message ?? err}`);
  process.exit(1);
});
