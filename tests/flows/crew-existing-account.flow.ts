import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Crew: an EXISTING PlusOne account added as external crew (z8uq9m2yvp, #24).
 *
 * staff@ is a member of Club Vesper (company …0001). admin@, admin of De
 * Marktzaal (company …0002), adds staff@'s address as crew on a Marktzaal
 * event through the crew sheet. Before this fix the action answered "This
 * email already has an account…"; now it resolves the account and adds it,
 * with the same success copy a brand-new address gets (no enumeration oracle).
 * Then staff@ switches to Marktzaal and sees exactly that event: not the other
 * Marktzaal event, and no Marktzaal membership.
 *
 * Fixtures: two Marktzaal events with fixed ids, upserted through the service
 * client (the seed has none there); staff@'s crew row on them is cleared at the
 * start of each variant so every variant walks the real add. Plain seed, no
 * `pnpm dev:mfa` needed.
 */

const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const CREW_EVENT = 'ee000000-0000-7000-8000-0000000c4e01';
const OTHER_EVENT = 'ee000000-0000-7000-8000-0000000c4e02';
const CREW_EVENT_NAME = 'Marktzaal Crew Night';
const OTHER_EVENT_NAME = 'Marktzaal Closed Session';
const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  await acceptConsent(STAFF);
  const a = adminClient();
  const adminId = await getUserIdByEmail(ADMIN);
  const { error: snooze } = await a.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId ?? '');
  if (snooze) throw new Error(`crew flow setup: ${snooze.message}`);
  const start = Date.now() + 7 * 24 * 3600 * 1000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const { error } = await a.from('events').upsert(
    [
      { id: CREW_EVENT, venue_id: MARKTZAAL, name: CREW_EVENT_NAME, landing_slug: 'flow-crew-night-c4e01', starts_at: iso(start), ends_at: iso(start + 6 * 3600 * 1000), status: 'open' },
      { id: OTHER_EVENT, venue_id: MARKTZAAL, name: OTHER_EVENT_NAME, landing_slug: 'flow-closed-session-c4e02', starts_at: iso(start + 86400000), ends_at: iso(start + 86400000 + 6 * 3600 * 1000), status: 'open' },
    ],
    { onConflict: 'id' },
  );
  if (error) throw new Error(`crew flow setup: ${error.message}`);
});

test('crew: an existing account is added as crew and sees only that event', async ({ page, context, flow, baseURL }) => {
  const a = adminClient();
  const staffId = (await getUserIdByEmail(STAFF)) ?? '';
  // Start each variant with staff@ off the crew, so the add below is real.
  const { error: clearErr } = await a.from('event_organizers').delete().eq('event_id', CREW_EVENT).eq('user_id', staffId);
  if (clearErr) throw new Error(`crew flow reset: ${clearErr.message}`);

  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: MARKTZAAL, domain: host, path: '/' }]);

  // ── admin@ (De Marktzaal) adds staff@ (Club Vesper) as crew ──────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${CREW_EVENT}/crew`);
  await page.waitForURL(new RegExp(`/app/events/${CREW_EVENT}/crew`));
  await expect(page.getByText('External crew').first()).toBeVisible();
  await flow.shot('crew-before');

  await flow.check(1, 'Crew screen opens for the Marktzaal event with staff@ (Tom Bakker) not on the crew', async () => {
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText('Tom Bakker')).toHaveCount(0);
  });

  await page.getByRole('button', { name: /Add external crew/ }).click();
  await page.getByPlaceholder('dj@email.com').fill(STAFF);
  await flow.shot('sheet-filled');
  await page.getByRole('button', { name: /Send invite/ }).click();

  await flow.check(2, 'Success notice: "Added to the crew. They’ll see this event when they log in with this email."', async () => {
    await expect(page.getByRole('status')).toHaveText('Added to the crew. They’ll see this event when they log in with this email.');
  });
  await flow.check(3, 'No error and no "already has an account" message', async () => {
    // The crew sheet's error line (Next's route announcer also carries role=alert).
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveText(/already has an account/i);
  });
  await flow.check(4, 'staff@ (Tom Bakker) now shows in the crew list', async () => {
    await expect(page.getByText('Tom Bakker').first()).toBeVisible();
  });
  await flow.shot('crew-added');

  await flow.check(5, 'Database: one event_organizers row for staff@ on the event, no Marktzaal membership, nothing on the other event', async () => {
    const { data: org } = await a.from('event_organizers').select('event_id').eq('user_id', staffId).in('event_id', [CREW_EVENT, OTHER_EVENT]);
    expect(org).toEqual([{ event_id: CREW_EVENT }]);
    const { data: mem } = await a.from('venue_memberships').select('venue_id').eq('user_id', staffId).eq('venue_id', MARKTZAAL);
    expect(mem).toEqual([]);
  });
  await flow.check(6, 'Admin crew screen: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });

  // ── staff@ logs in and looks at De Marktzaal ─────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app/events`);
  await page.waitForURL(/\/app\/events/);
  await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
  await flow.shot('staff-events');

  await flow.check(7, 'staff@ at De Marktzaal sees the crew event and not the other Marktzaal event', async () => {
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText(OTHER_EVENT_NAME)).toHaveCount(0);
  });
  await flow.check(8, 'staff@ events screen: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });
});
