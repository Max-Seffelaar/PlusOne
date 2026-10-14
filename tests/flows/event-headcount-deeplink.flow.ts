import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: an event screen opened cold (deep link / refresh, so no cached venue
 * list) counts heads for THAT event only (Snelheid P2, P1-review follow-up
 * "single-event headcounts", z8uq9m2xz2 9-FE), in all four variants.
 *
 *   admin@ → straight to /app/events/<fixture> → "On the list" shows the
 *   fixture's 1 + plus_ones total → the one venue_event_headcounts call carries
 *   p_event_id (never a p_since window that scans every later event).
 *
 * Fixture: one Club Vesper event two weeks out with two guests (+1 and +2 =
 * 5 heads), upserted on fixed ids; it stays, like the other flows' fixtures.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-0000000f9e01';
const TIER = 'dd000000-0000-7000-8000-0000000f9d01';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const db = adminClient();
  const { error: pErr } = await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (pErr) throw new Error(`event-headcount-deeplink setup: ${pErr.message}`);
  const start = Date.now() + 14 * 24 * 3600 * 1000;
  const { error: eErr } = await db.from('events').upsert({
    id: EVENT, venue_id: VENUE, name: 'Headcount Deep Link', landing_slug: 'flow-headcount-deeplink-f9e01',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 6 * 3600 * 1000).toISOString(), status: 'open',
  }, { onConflict: 'id' });
  if (eErr) throw new Error(`event-headcount-deeplink event: ${eErr.message}`);
  const { error: tErr } = await db.from('guest_tiers')
    .upsert({ id: TIER, event_id: EVENT, name: 'Regular', color: '#8A8A93', aliases: [] }, { onConflict: 'id', ignoreDuplicates: true });
  if (tErr) throw new Error(`event-headcount-deeplink tier: ${tErr.message}`);
  const { error: gErr } = await db.from('guests').upsert([
    { id: 'cc000000-0000-7000-8000-0000000f9c01', event_id: EVENT, tier_id: TIER, full_name: 'Deep Link One', plus_ones: 1, added_by: adminId, source: 'app' },
    { id: 'cc000000-0000-7000-8000-0000000f9c02', event_id: EVENT, tier_id: TIER, full_name: 'Deep Link Two', plus_ones: 2, added_by: adminId, source: 'app' },
  ] as never, { onConflict: 'id', ignoreDuplicates: true });
  if (gErr) throw new Error(`event-headcount-deeplink guests: ${gErr.message}`);
});

test('event deep link: the headcount reads one event, not the venue history after it', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  const headcountBodies: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/rpc/venue_event_headcounts')) headcountBodies.push(r.postData() ?? '');
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${EVENT}`);
  await page.waitForURL(new RegExp(`/app/events/${EVENT}`));
  const onList = page.getByText('On the list', { exact: true }).first();
  await expect(onList).toBeVisible({ timeout: 20_000 });
  await flow.shot('event-cold');

  await flow.check(1, '"On the list" shows the fixture event\'s heads (1 + 1 and 1 + 2 = 5)', async () => {
    await expect(onList.locator('..')).toContainText('5');
  });
  await flow.check(2, 'The cold event read asks venue_event_headcounts for this event (p_event_id), never with a p_since window', async () => {
    const scoped = headcountBodies.filter((b) => b.includes(EVENT));
    expect(scoped.length).toBeGreaterThanOrEqual(1);
    for (const b of scoped) {
      expect(JSON.parse(b)).toMatchObject({ p_event_id: EVENT });
      expect(JSON.parse(b)).not.toHaveProperty('p_since');
    }
  });
  await flow.check(3, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
