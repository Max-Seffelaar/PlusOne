import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Snelheid P2 finding 14 (z8uq9m2xz2 9-FE), in all four variants.
 *
 *   admin@ → an upcoming Club Vesper event → its stats panel does NOT poll
 *   (only a live event's does) → the event's guest list → Add guest → quick
 *   add "Nina <variant>" → Back: Nina is on the list with "Added by …" from the
 *   server row, and the list was never re-downloaded (one single-row read).
 *
 * Fixture (fixed ids, stays): one Club Vesper event 12 days out (after the
 * seed's launch night, so it never becomes another flow's featured event)
 * with one tier and one guest. Each variant adds its own guest.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const EVENT = 'ee000000-0000-7000-8000-0000000f7e01';
const TIER = 'dd000000-0000-7000-8000-0000000f7d01';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const db = adminClient();
  const must = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`guest-add-patch ${what}: ${error.message}`);
  };
  must('profile', (await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId)).error);
  const start = Date.now() + 12 * 24 * 3600 * 1000;
  must('event', (await db.from('events').upsert({
    id: EVENT, venue_id: VENUE, name: 'Patch Night', landing_slug: 'flow-patch-night-f7e01', status: 'open',
    starts_at: new Date(start).toISOString(), ends_at: new Date(start + 6 * 3600 * 1000).toISOString(),
  }, { onConflict: 'id' })).error);
  must('tier', (await db.from('guest_tiers')
    .upsert({ id: TIER, event_id: EVENT, name: 'Regular', color: '#8A8A93', aliases: [] }, { onConflict: 'id', ignoreDuplicates: true })).error);
  must('guest', (await db.from('guests').upsert({
    id: 'cc000000-0000-7000-8000-0000000f7c01', event_id: EVENT, tier_id: TIER, full_name: 'Patch Existing',
    plus_ones: 0, added_by: adminId, source: 'app',
  } as never, { onConflict: 'id', ignoreDuplicates: true })).error);
});

test('guest add patches one row; an upcoming event\'s stats do not poll', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  const rest: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/rest/v1/')) rest.push(decodeURIComponent(r.url()));
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${EVENT}`);
  await expect(page.getByText('Patch Night').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('event-upcoming');
  rest.length = 0;
  await page.waitForTimeout(16_500);
  await flow.check(1, 'An upcoming event\'s stats panel does not poll (no stats RPC in 16 s; only a live event refreshes every 15 s)', async () => {
    expect(rest.filter((u) => u.includes('/rpc/event_stats_summary'))).toEqual([]);
  });

  await page.goto(`/app/events/${EVENT}/guests`);
  await expect(page.getByText('Patch Existing').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Add guest', exact: true }).filter({ visible: true }).first().click();
  await page.waitForURL(new RegExp(`/app/events/${EVENT}/add`));
  const name = `Nina ${flow.variant.split('-')[0]} ${Date.now().toString(36)}`;
  await page.getByPlaceholder(/John Doe/).fill(name);
  rest.length = 0;
  await page.getByRole('button', { name: new RegExp(`^Add · ${name}`) }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('quick-add-done');

  await page.goBack();
  await page.waitForURL(new RegExp(`/app/events/${EVENT}/guests`));
  const row = page.getByText(name).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('list-after-add');
  await flow.check(2, 'The new guest is on the list with the server\'s provenance ("Added by …")', async () => {
    await expect(page.getByText(/Added by/).first()).toBeVisible();
  });
  await flow.check(3, 'The add read ONE row (guests?id=eq.…) and never re-downloaded the event\'s list', async () => {
    const guestReads = rest.filter((u) => u.includes('/rest/v1/guests?') && u.includes(`event_id=eq.${EVENT}`));
    expect(guestReads.length).toBeGreaterThanOrEqual(1);
    expect(guestReads.filter((u) => !/[?&]id=eq\./.test(u))).toEqual([]);
  });
  await flow.check(4, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
