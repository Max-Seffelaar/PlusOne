import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Team → External crew → Manage (z8uq9m2yvp): an admin manages a crew member
 * from the Team screen, across every event of the company they are crew on,
 * without opening each event's crew sheet.
 *
 * Seed: organizer@ (Yusuf Demir) is crew on PLUSONE Launch Night at Club
 * Vesper, with no membership there. The flow adds two fixture Vesper events
 * with Yusuf as crew on both (one with a quota of 3), so the sheet shows three
 * events. admin@ raises the quota on the first fixture and removes Yusuf from
 * the second; the seed crew row is never touched. manager@ (user_manager) sees
 * the crew list but no Manage.
 *
 * Every variant starts from the same fixture state, and afterAll removes the
 * fixtures again (and restores admin@'s MFA snooze), so the shared plain seed
 * is left as it was found.
 */

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const SEED_EVENT_NAME = 'PLUSONE Launch Night';
const QUOTA_EVENT = 'ee000000-0000-7000-8000-0000000c4e11';
const REMOVE_EVENT = 'ee000000-0000-7000-8000-0000000c4e12';
const QUOTA_EVENT_NAME = 'Vesper Crew Friday';
const REMOVE_EVENT_NAME = 'Vesper Crew Saturday';
const FIXTURE_EVENTS = [QUOTA_EVENT, REMOVE_EVENT];
const ADMIN = 'admin@plusone.test';
const MANAGER = 'manager@plusone.test';
const ORGANIZER = 'organizer@plusone.test';
const CREW_NAME = 'Yusuf Demir';

let adminSnoozeBefore: string | null = null;

async function resetFixtureCrew(): Promise<void> {
  const a = adminClient();
  const yusuf = (await getUserIdByEmail(ORGANIZER)) ?? '';
  for (const [table, q] of [
    ['event_quotas', a.from('event_quotas').delete().eq('user_id', yusuf).in('event_id', FIXTURE_EVENTS)],
    ['event_organizers', a.from('event_organizers').delete().eq('user_id', yusuf).in('event_id', FIXTURE_EVENTS)],
  ] as const) {
    const { error } = await q;
    if (error) throw new Error(`team crew flow cleanup (${table}): ${error.message}`);
  }
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  await acceptConsent(MANAGER);
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { data: prof } = await a.from('user_profiles').select('mfa_snooze_until').eq('id', adminId).maybeSingle();
  adminSnoozeBefore = prof?.mfa_snooze_until ?? null;
  const { error: snooze } = await a.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (snooze) throw new Error(`team crew flow setup: ${snooze.message}`);
  const start = Date.now() + 9 * 24 * 3600 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const { error } = await a.from('events').upsert(
    [
      { id: QUOTA_EVENT, venue_id: VESPER, name: QUOTA_EVENT_NAME, landing_slug: 'flow-vesper-crew-friday-c4e11', starts_at: iso(start), ends_at: iso(start + 6 * 3600 * 1000), status: 'open' },
      { id: REMOVE_EVENT, venue_id: VESPER, name: REMOVE_EVENT_NAME, landing_slug: 'flow-vesper-crew-saturday-c4e12', starts_at: iso(start + 86400000), ends_at: iso(start + 86400000 + 6 * 3600 * 1000), status: 'open' },
    ],
    { onConflict: 'id' },
  );
  if (error) throw new Error(`team crew flow setup: ${error.message}`);
});

test.afterAll(async () => {
  await resetFixtureCrew();
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  await a.from('user_profiles').update({ mfa_snooze_until: adminSnoozeBefore }).eq('id', adminId);
  // The fixture events go too when nothing references them any more; if the
  // audit trail holds on to them, they stay as harmless future events.
  await a.from('events').delete().in('id', FIXTURE_EVENTS);
});

test('team: an admin manages external crew per event from the Team screen', async ({ page, context, flow, baseURL }) => {
  await resetFixtureCrew();
  const a = adminClient();
  const yusuf = (await getUserIdByEmail(ORGANIZER)) ?? '';
  {
    const { error } = await a.from('event_organizers').insert(FIXTURE_EVENTS.map((event_id) => ({ event_id, user_id: yusuf })));
    if (error) throw new Error(`team crew flow setup (crew rows): ${error.message}`);
    const { error: q } = await a.from('event_quotas').insert({ event_id: QUOTA_EVENT, user_id: yusuf, quota_override: 3 });
    if (q) throw new Error(`team crew flow setup (quota): ${q.message}`);
  }

  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VESPER, domain: host, path: '/' }]);

  // ── admin@ (Club Vesper) opens Team ──────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/team`);
  await page.waitForURL(/\/app\/team/);
  const manage = page.getByRole('button', { name: `Manage ${CREW_NAME}` });
  await expect(page.getByText('External crew').first()).toBeVisible();
  await flow.shot('team');

  await flow.check(1, 'Team → External crew lists Yusuf Demir with a Manage button for the admin', async () => {
    await expect(page.getByText(CREW_NAME).first()).toBeVisible();
    await expect(manage).toBeVisible();
  });

  await manage.click();
  const rows = page.getByTestId('crew-event-row');
  await flow.check(2, 'Manage opens a sheet "Crew on" with all three events he is crew on, in date order', async () => {
    await expect(page.getByText('Crew on', { exact: true })).toBeVisible();
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText(SEED_EVENT_NAME);
    await expect(rows.nth(1)).toContainText(QUOTA_EVENT_NAME);
    await expect(rows.nth(2)).toContainText(REMOVE_EVENT_NAME);
  });
  await flow.shot('sheet');

  const quotaRow = rows.filter({ hasText: QUOTA_EVENT_NAME });
  await flow.check(3, 'Each event shows its own guest quota (Vesper Crew Friday: 3), no Save until it changes', async () => {
    await expect(quotaRow).toContainText('3');
    await expect(quotaRow.getByRole('button', { name: 'Save' })).toHaveCount(0);
  });

  await quotaRow.getByRole('button', { name: 'More' }).click();
  await quotaRow.getByRole('button', { name: 'Save' }).click();
  await flow.check(4, 'Quota +1 → Save stores 4 for that event only (database), and the Save button goes', async () => {
    await expect(quotaRow.getByRole('button', { name: 'Save' })).toHaveCount(0);
    await expect
      .poll(async () => (await a.from('event_quotas').select('event_id, quota_override').eq('user_id', yusuf).in('event_id', FIXTURE_EVENTS)).data)
      .toEqual([{ event_id: QUOTA_EVENT, quota_override: 4 }]);
  });
  await flow.shot('quota-saved');

  const removeRow = rows.filter({ hasText: REMOVE_EVENT_NAME });
  await removeRow.getByRole('button', { name: 'Remove from crew' }).click();
  await flow.check(5, 'Remove from crew asks first, naming him and the event, and changes nothing yet', async () => {
    await expect(removeRow).toContainText(`Remove ${CREW_NAME} from the crew of ${REMOVE_EVENT_NAME}?`);
    const { data } = await a.from('event_organizers').select('event_id').eq('user_id', yusuf).eq('event_id', REMOVE_EVENT);
    expect(data).toEqual([{ event_id: REMOVE_EVENT }]);
  });
  await flow.shot('remove-confirm');

  await removeRow.getByRole('button', { name: 'Remove from crew' }).click();
  await flow.check(6, 'Confirming removes him from that event only: the row leaves the sheet and the database; the other two stay', async () => {
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: REMOVE_EVENT_NAME })).toHaveCount(0);
    const { data } = await a.from('event_organizers').select('event_id').eq('user_id', yusuf).in('event_id', FIXTURE_EVENTS);
    expect(data).toEqual([{ event_id: QUOTA_EVENT }]);
  });
  await flow.shot('removed');

  await flow.check(7, 'Sheet: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });

  await page.getByRole('button', { name: 'Done' }).click();
  await flow.check(8, 'After Done and a reload the Team list still shows him (two events left), quota still 4', async () => {
    await page.reload();
    await expect(page.getByText(CREW_NAME).first()).toBeVisible();
    await manage.click();
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: QUOTA_EVENT_NAME })).toContainText('4');
  });

  // ── manager@ (user_manager) sees the list but cannot manage ──────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(MANAGER)}&next=/app/team`);
  await page.waitForURL(/\/app\/team/);
  await flow.check(9, 'A user_manager sees Yusuf Demir under External crew but no Manage button', async () => {
    await expect(page.getByText(CREW_NAME).first()).toBeVisible();
    await expect(page.getByRole('button', { name: `Manage ${CREW_NAME}` })).toHaveCount(0);
  });
  await flow.shot('manager-view');
});
