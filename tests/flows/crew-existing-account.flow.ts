import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Crew: an EXISTING PlusOne account invited as external crew (z8uq9m2yvp, #24,
 * decision Max 2026-10-07: crew goes through an invite the person accepts).
 *
 * staff@ is a member of Club Vesper (company …0001). admin@, admin of De
 * Marktzaal (company …0002), invites staff@'s address as crew on a Marktzaal
 * event through the crew sheet. The sheet answers the same for a new address
 * and an existing account, and nothing about staff@ changes yet: no crew row,
 * so the crew list stays empty. staff@ then sees the invite in the Home banner
 * ("Crew · <event> at De Marktzaal"), accepts, and sees exactly that event at
 * De Marktzaal: not the other Marktzaal event, and no Marktzaal membership.
 * Back as admin@, the crew list now shows staff@.
 *
 * The "company can't read the profile before accept" property itself is the
 * pgTAP proof (crew_invites.test.sql B1/B10) with an admin who shares no company
 * with the invitee; admin@ shares Club Vesper with staff@ in the seed, so here
 * Q4/Q5 check what the crew screen shows and that no crew row exists.
 *
 * Fixtures: two Marktzaal events with fixed ids (the seed has none there),
 * upserted through the service client. Every variant starts from no invite and
 * no crew row, and afterAll removes all of it again (and restores admin@'s MFA
 * snooze), so the shared plain seed is left as it was found.
 */

const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const CREW_EVENT = 'ee000000-0000-7000-8000-0000000c4e01';
const OTHER_EVENT = 'ee000000-0000-7000-8000-0000000c4e02';
const CREW_EVENT_NAME = 'Marktzaal Crew Night';
const OTHER_EVENT_NAME = 'Marktzaal Closed Session';
const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';
const EVENTS = [CREW_EVENT, OTHER_EVENT];

let adminSnoozeBefore: string | null = null;

/** The per-address mail window (mail_recipient_window(), 60 s) applies across
 *  the four variants too: wait it out instead of tampering with mail_log (no
 *  app role, service_role included, may read or write it), so each variant's
 *  invite mail really goes. The last send time is kept in a file because the
 *  variants run in separate worker processes. */
const LAST_INVITE_FILE = resolve(process.cwd(), 'test-results/flows/.crew-existing-account-last-invite');

async function waitOutMailWindow(page: import('@playwright/test').Page): Promise<void> {
  let last = 0;
  try {
    last = Number(readFileSync(LAST_INVITE_FILE, 'utf8')) || 0;
  } catch {
    last = 0;
  }
  const wait = last + 62_000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
}

function markInviteSent(): void {
  mkdirSync(dirname(LAST_INVITE_FILE), { recursive: true });
  writeFileSync(LAST_INVITE_FILE, String(Date.now()));
}

async function clearCrewState(): Promise<void> {
  const a = adminClient();
  const staffId = (await getUserIdByEmail(STAFF)) ?? '';
  for (const [table, q] of [
    ['event_quotas', a.from('event_quotas').delete().eq('user_id', staffId).in('event_id', EVENTS)],
    ['event_organizers', a.from('event_organizers').delete().eq('user_id', staffId).in('event_id', EVENTS)],
    ['invites', a.from('invites').delete().eq('venue_id', MARKTZAAL).ilike('email', STAFF)],
  ] as const) {
    const { error } = await q;
    if (error) throw new Error(`crew flow cleanup (${table}): ${error.message}`);
  }
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  await acceptConsent(STAFF);
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { data: prof } = await a.from('user_profiles').select('mfa_snooze_until').eq('id', adminId).maybeSingle();
  adminSnoozeBefore = prof?.mfa_snooze_until ?? null;
  const { error: snooze } = await a.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
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

test.afterAll(async () => {
  await clearCrewState();
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  await a.from('user_profiles').update({ mfa_snooze_until: adminSnoozeBefore }).eq('id', adminId);
  // The fixture events go too when nothing references them any more; if the
  // audit trail holds on to them, they stay as harmless future events.
  await a.from('events').delete().in('id', EVENTS);
});

test('crew: an existing account is invited, accepts in the banner, and sees only that event', async ({ page, context, flow, baseURL }) => {
  await clearCrewState();
  const a = adminClient();
  const staffId = (await getUserIdByEmail(STAFF)) ?? '';

  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: MARKTZAAL, domain: host, path: '/' }]);

  // ── admin@ (De Marktzaal) invites staff@ (Club Vesper) as crew ───────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${CREW_EVENT}/crew`);
  await page.waitForURL(new RegExp(`/app/events/${CREW_EVENT}/crew`));
  await expect(page.getByText('External crew').first()).toBeVisible();
  await flow.shot('crew-before');

  await flow.check(1, 'Crew screen opens for the Marktzaal event with staff@ (Tom Bakker) not on the crew', async () => {
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText('Tom Bakker')).toHaveCount(0);
  });

  await waitOutMailWindow(page);
  await page.getByRole('button', { name: /Add external crew/ }).click();
  await page.getByPlaceholder('dj@email.com').fill(STAFF);
  await flow.shot('sheet-filled');
  await page.getByRole('button', { name: /Send invite/ }).click();
  markInviteSent();

  await flow.check(2, 'Success notice: "Invite sent. They’re on the crew once they accept." (same for a new address)', async () => {
    await expect(page.getByRole('status')).toHaveText('Invite sent. They’re on the crew once they accept.');
  });
  await flow.check(3, 'No error and no "already has an account" message', async () => {
    // The crew sheet's error line (Next's route announcer also carries role=alert).
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveText(/already has an account/i);
  });
  await flow.shot('invite-sent');

  await flow.check(4, 'Before accept: the crew list shows no name or phone of staff@', async () => {
    await page.reload();
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText('Tom Bakker')).toHaveCount(0);
    await expect(page.getByText('+31600000006')).toHaveCount(0);
  });
  await flow.check(5, 'Before accept, in the database: one open crew invite (no roles, this event), no crew row, no membership', async () => {
    const { data: inv } = await a.from('invites').select('roles, event_ids, accepted_at').eq('venue_id', MARKTZAAL).ilike('email', STAFF);
    expect(inv).toEqual([{ roles: [], event_ids: [CREW_EVENT], accepted_at: null }]);
    const { data: org } = await a.from('event_organizers').select('event_id').eq('user_id', staffId).in('event_id', EVENTS);
    expect(org).toEqual([]);
  });
  await flow.check(6, 'Admin crew screen: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });

  // ── staff@ logs in: the invite waits in the Home banner ──────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app`);
  await page.waitForURL(/\/app/);
  const banner = page.getByText(`Crew · ${CREW_EVENT_NAME} at De Marktzaal`);
  await flow.check(7, 'Logging in did not accept it: the Home banner shows "Crew · Marktzaal Crew Night at De Marktzaal"', async () => {
    await expect(banner).toBeVisible();
  });
  await flow.shot('banner');

  await page.getByRole('button', { name: /Accept invite/ }).click();
  await flow.check(8, 'After "Accept invite" the banner is gone', async () => {
    await expect(banner).toHaveCount(0);
  });

  await page.goto(new URL('/app/events', baseURL).toString());
  await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
  await flow.shot('staff-events');

  await flow.check(9, 'staff@ at De Marktzaal sees the crew event and not the other Marktzaal event', async () => {
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText(OTHER_EVENT_NAME)).toHaveCount(0);
  });
  await flow.check(10, 'After accept, in the database: crew on that event only, no Marktzaal membership', async () => {
    const { data: org } = await a.from('event_organizers').select('event_id').eq('user_id', staffId).in('event_id', EVENTS);
    expect(org).toEqual([{ event_id: CREW_EVENT }]);
    const { data: mem } = await a.from('venue_memberships').select('venue_id').eq('user_id', staffId).eq('venue_id', MARKTZAAL);
    expect(mem).toEqual([]);
  });
  await flow.check(11, 'staff@ screens: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });

  // ── admin@ again: now the crew list shows staff@ ─────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${CREW_EVENT}/crew`);
  await page.waitForURL(new RegExp(`/app/events/${CREW_EVENT}/crew`));
  await flow.check(12, 'After accept, the admin’s crew list shows Tom Bakker', async () => {
    await expect(page.getByText('Tom Bakker').first()).toBeVisible();
  });
  await flow.shot('crew-after-accept');
});
