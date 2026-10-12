import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: the events window (Snelheid P2 findings 4 + 12, z8uq9m2xz2 9-FE), in
 * all four variants.
 *
 *   admin@ on a fixture company → Home → Events: the tab opens from the cache
 *   Home already filled (no new events read) → Past shows the last 30 days
 *   only → "Show older events" pages in the rest → no events read on the wire
 *   is ever unbounded (each carries a window or a cursor, or names one event).
 *
 * Fixture (fixed ids, stays): company "Flow Events Window" where admin@ is
 * admin, one event 3 days ahead and past events 10, 20, 45, 60 and 90 days
 * back. Its own company, so no other flow's lists change.
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const VENUE = 'fe000000-0000-7000-8000-0000000f4a00';
const DAY = 24 * 3600 * 1000;
const FIXTURE = [
  { n: 1, name: 'Window Upcoming', offsetDays: 3 },
  { n: 2, name: 'Window Past 10', offsetDays: -10 },
  { n: 3, name: 'Window Past 20', offsetDays: -20 },
  { n: 4, name: 'Older Past 45', offsetDays: -45 },
  { n: 5, name: 'Older Past 60', offsetDays: -60 },
  { n: 6, name: 'Older Past 90', offsetDays: -90 },
];

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const db = adminClient();
  const must = (what: string, error: { message: string } | null): void => {
    if (error) throw new Error(`events-window ${what}: ${error.message}`);
  };
  must('profile', (await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId)).error);
  must('venue', (await db.from('venues').upsert({ id: VENUE, name: 'Flow Events Window', slug: 'flow-events-window' }, { onConflict: 'id' })).error);
  must('membership', (await db.from('venue_memberships')
    .upsert({ venue_id: VENUE, user_id: adminId, roles: ['admin'] }, { onConflict: 'venue_id,user_id' })).error);
  const base = new Date();
  base.setHours(22, 0, 0, 0);
  must('events', (await db.from('events').upsert(FIXTURE.map((e) => {
    const start = base.getTime() + e.offsetDays * DAY;
    return {
      id: `ee000000-0000-7000-8000-0000000f4a0${e.n}`, venue_id: VENUE, name: e.name,
      landing_slug: `flow-events-window-${e.n}`, starts_at: new Date(start).toISOString(),
      ends_at: new Date(start + 6 * 3600 * 1000).toISOString(), status: e.offsetDays < 0 ? 'closed' : 'open',
    };
  }), { onConflict: 'id' })).error);
});

test('events window: Events opens from Home\'s cache, Past pages back on request, no unbounded reads', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VENUE, domain: host, path: '/' }]);
  const eventReads: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'GET' && r.url().includes('/rest/v1/events?')) eventReads.push(decodeURIComponent(r.url()));
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app`);
  await page.waitForURL(/\/app/);
  await expect(page.getByText('Window Upcoming').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('home');

  const beforeTab = eventReads.length;
  // In-app tab tap (bottom tabs on a phone, the sidebar from 1024px): the
  // React Query cache survives it, which is the point.
  await page.getByRole('button', { name: 'Events', exact: true }).filter({ visible: true }).first().click();
  await page.waitForURL(/\/app\/events/);
  await expect(page.getByRole('button', { name: 'Past', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Window Upcoming').first()).toBeVisible();
  await page.waitForLoadState('networkidle').catch(() => {});
  await flow.shot('events-upcoming');
  await flow.check(1, 'The Events tab renders from the event window Home already loaded (no new events read)', async () => {
    expect(eventReads.slice(beforeTab)).toEqual([]);
  });

  await page.getByRole('button', { name: 'Past', exact: true }).click();
  await expect(page.getByText('Window Past 10').first()).toBeVisible();
  await flow.shot('events-past-window');
  await flow.check(2, 'Past shows the last 30 days only: 10 and 20 days back, not 45', async () => {
    await expect(page.getByText('Window Past 20').first()).toBeVisible();
    await expect(page.getByText('Older Past 45')).toHaveCount(0);
  });

  const older = page.getByRole('button', { name: 'Show older events' });
  await older.click();
  await expect(page.getByText('Older Past 45').first()).toBeVisible({ timeout: 20_000 });
  await flow.shot('events-past-older');
  await flow.check(3, '"Show older events" pages in the rest (45, 60, 90 days back) and then disappears', async () => {
    await expect(page.getByText('Older Past 60').first()).toBeVisible();
    await expect(page.getByText('Older Past 90').first()).toBeVisible();
    await expect(older).toHaveCount(0);
  });
  await flow.check(4, 'Every events read carries a window (starts_at=gte), a cursor (lt) or one id — never the venue\'s whole history', async () => {
    const unbounded = eventReads.filter((u) => !/starts_at=gte\.|starts_at\.lt|starts_at=lt\.|[?&]id=eq\./.test(u));
    expect(unbounded).toEqual([]);
  });
  await flow.check(5, 'No sideways scroll and no uncaught page errors', async () => {
    expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
