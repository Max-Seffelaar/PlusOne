import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow, onlyVariants } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the desktop event-day cockpit patches itself from realtime (Snelheid
 * P2 finding 10, z8uq9m2xz2 9-FE). Desktop browser only: the cockpit is the
 * Deur tab's fine-pointer ≥1024px variant; every other variant gets the mobile
 * door, which this PR does not touch.
 *
 *   admin@ → a fresh live Club Vesper event with 12 guests → Deur tab
 *   (cockpit) → a colleague's door checks 6 guests in, 400 ms apart → Inside
 *   reads 6 and those rows show as inside, without one guest-list or
 *   check-in re-download → a colleague voids one → Inside reads 5 → the tier
 *   and stats panels refresh a handful of times, not per check-in.
 *
 * Fixture: a new event per run (random ids), so reruns never share check-ins.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

onlyVariants('desktop-browser');

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const GUESTS = 12;
const CHECKINS = 6;
// The service role holds no UPDATE on check_ins (voids go through the door's
// RLS path); the colleague's void is written as the table owner, like
// guest-info.flow.ts reads its queue.
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

test('cockpit realtime: peers\' check-ins land without re-downloading the list', async ({ page, context, flow, baseURL }) => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const db = adminClient();
  const must = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`cockpit-realtime ${what}: ${error.message}`);
  };
  must('profile', (await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId)).error);
  const eventId = randomUUID();
  const tierId = randomUUID();
  const now = Date.now();
  must('event', (await db.from('events').insert({
    id: eventId, venue_id: VENUE, name: 'Cockpit Realtime Flow', landing_slug: `flow-cockpit-${eventId.slice(0, 8)}`, status: 'open',
    starts_at: new Date(now - 3600_000).toISOString(), ends_at: new Date(now + 5 * 3600_000).toISOString(),
  } as never)).error);
  must('tier', (await db.from('guest_tiers').insert({ id: tierId, event_id: eventId, name: 'Regular', color: '#8A8A93', aliases: [] })).error);
  const guests = Array.from({ length: GUESTS }, (_, i) => ({
    id: randomUUID(), event_id: eventId, tier_id: tierId, full_name: `Realtime Guest ${String(i + 1).padStart(2, '0')}`,
    plus_ones: 0, added_by: adminId, source: 'app', status: 'approved',
  }));
  must('guests', (await db.from('guests').insert(guests as never)).error);

  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  let counting = false;
  const reads: string[] = [];
  page.on('request', (r) => {
    if (counting && r.url().includes('/rest/v1/')) reads.push(new URL(r.url()).pathname.replace('/rest/v1/', ''));
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=${encodeURIComponent(`/app/door?event=${eventId}`)}`);
  await expect(page.getByText(/Realtime Guest \d+/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(`0 / ${GUESTS} people`).first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(2_000);
  await flow.shot('cockpit-before');

  counting = true;
  for (const g of guests.slice(0, CHECKINS)) {
    must('check-in', (await db.from('check_ins').insert({ guest_id: g.id, event_id: eventId, checked_by: adminId, plus_ones_arrived: 0 } as never)).error);
    await page.waitForTimeout(400);
  }
  await flow.check(1, `A colleague's ${CHECKINS} check-ins show up live: ${CHECKINS} / ${GUESTS} people inside`, async () => {
    await expect(page.getByText(`${CHECKINS} / ${GUESTS} people`).first()).toBeVisible({ timeout: 10_000 });
  });
  await page.getByRole('button', { name: /^Inside/ }).first().click();
  await flow.shot('cockpit-after-checkins');
  await flow.check(2, 'The checked-in guests are listed under Inside', async () => {
    await expect(page.getByText('Realtime Guest 01').first()).toBeVisible();
  });

  const owner = new pg.Client({ connectionString: PGURL });
  await owner.connect();
  try {
    await owner.query('update public.check_ins set voided_at = now(), voided_by = $1 where guest_id = $2', [adminId, guests[0].id]);
  } finally {
    await owner.end();
  }
  await flow.check(3, 'A colleague\'s void takes one off: Inside drops by one', async () => {
    await expect(page.getByText(`${CHECKINS - 1} / ${GUESTS} people`).first()).toBeVisible({ timeout: 10_000 });
  });
  await page.waitForTimeout(6_000);
  counting = false;
  await flow.shot('cockpit-after-void');

  await flow.check(4, 'No guest-list or check-in re-download for any of it (patched from the realtime payload)', async () => {
    expect(reads.filter((p) => p === 'guests' || p === 'check_ins')).toEqual([]);
  });
  await flow.check(5, `Tier occupancy refreshes a handful of times, not once per change (${CHECKINS + 1} changes)`, async () => {
    const occupancy = reads.filter((p) => p === 'rpc/event_tier_occupancy').length;
    expect(occupancy).toBeGreaterThanOrEqual(1);
    expect(occupancy).toBeLessThanOrEqual(4);
  });
  await flow.check(6, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
