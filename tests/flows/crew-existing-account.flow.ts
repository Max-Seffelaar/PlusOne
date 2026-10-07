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
 * Accept and decline are per invite and explicit (explicit-accept follow-up,
 * z8uq9m2yvp): a login accepts nothing, the Home banner and the /onboarding invite
 * step each carry Accept and Decline for ONE invite. Q19-Q22 cover the decline:
 * an account with no company declines on /onboarding, the invite closes, nothing
 * is granted, and the admin's "Waiting to accept" list drops it.
 *
 * Fixtures: two Marktzaal events with fixed ids (the seed has none there),
 * upserted through the service client. Every variant starts from no invite and
 * no crew row, and afterAll removes all of it again (and restores admin@'s MFA
 * snooze), so the shared plain seed is left as it was found.
 *
 * QA EXCEPTION: that cleanup (clearCrewState, afterAll) HARD-DELETES invites,
 * event_organizers, event_quotas, events, user_profiles and auth users through
 * the service client. App roles can never do that (soft delete only, decisions
 * #3/#21); this runs against the local stack only, as test-fixture teardown, and
 * is the one place hard deletes are allowed. Never copy it into app code.
 */

const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const CREW_EVENT = 'ee000000-0000-7000-8000-0000000c4e01';
const OTHER_EVENT = 'ee000000-0000-7000-8000-0000000c4e02';
const CREW_EVENT_NAME = 'Marktzaal Crew Night';
const OTHER_EVENT_NAME = 'Marktzaal Closed Session';
const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';
const EVENTS = [CREW_EVENT, OTHER_EVENT];
// A crew-only account: exists, consented, no company and no crew scope (review
// round 2 finding 3), and an address the admin mistypes and revokes (finding 6).
const CREW_ONLY = 'crewonly@plusone.test';
const TYPO = 'typo-crew@plusone.test';
// An existing account with no company that DECLINES its invite (Q19-Q22).
const DECLINER = 'decliner@plusone.test';

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
  for (const email of [STAFF, CREW_ONLY, TYPO, DECLINER]) {
    const id = await getUserIdByEmail(email);
    const steps = [['invites', a.from('invites').delete().eq('venue_id', MARKTZAAL).ilike('email', email)]] as const;
    for (const [table, q] of id
      ? ([
          ['event_quotas', a.from('event_quotas').delete().eq('user_id', id).in('event_id', EVENTS)],
          ['event_organizers', a.from('event_organizers').delete().eq('user_id', id).in('event_id', EVENTS)],
          ...steps,
        ] as const)
      : steps) {
      const { error } = await q;
      if (error) throw new Error(`crew flow cleanup (${table}): ${error.message}`);
    }
  }
}

/** An existing, consented login with no company and no crew scope (the crew-only
 *  account, and the one that declines). Created once (idempotent), removed again
 *  in afterAll. */
async function ensureCompanylessAccount(email: string, fullName: string): Promise<void> {
  const a = adminClient();
  if (!(await getUserIdByEmail(email))) {
    const { error } = await a.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: fullName } });
    if (error) throw new Error(`crew flow setup (${email}): ${error.message}`);
  }
  const id = (await getUserIdByEmail(email)) ?? '';
  const { error } = await a
    .from('user_profiles')
    .upsert({ id, full_name: fullName, email }, { onConflict: 'id', ignoreDuplicates: true });
  if (error) throw new Error(`crew flow setup (${email} profile): ${error.message}`);
  await acceptConsent(email);
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  await acceptConsent(STAFF);
  await ensureCompanylessAccount(CREW_ONLY, 'Robin Crew');
  await ensureCompanylessAccount(DECLINER, 'Dani Decliner');
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
  // The two throwaway logins go again (best effort: an audit row may pin them).
  for (const email of [CREW_ONLY, TYPO, DECLINER]) {
    const id = await getUserIdByEmail(email);
    if (!id) continue;
    await a.from('user_profiles').delete().eq('id', id);
    await a.auth.admin.deleteUser(id);
  }
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

  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await flow.check(8, 'After "Accept" the banner is gone', async () => {
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

  // ── Pending crew invites on the sheet: shown, and revocable (finding 6) ──
  async function invite(email: string): Promise<void> {
    await waitOutMailWindow(page);
    await page.getByRole('button', { name: /Add external crew/ }).click();
    await page.getByPlaceholder('dj@email.com').fill(email);
    await page.getByRole('button', { name: /Send invite/ }).click();
    markInviteSent();
    await expect(page.getByRole('status')).toHaveText('Invite sent. They’re on the crew once they accept.');
  }
  await invite(CREW_ONLY);
  await invite(TYPO);
  await invite(DECLINER);
  const pending = page.getByTestId('crew-invite-row');
  await flow.check(13, 'The crew sheet shows the open invites under "Waiting to accept", each "Expires in 7 days"', async () => {
    await expect(page.getByText('Waiting to accept')).toBeVisible();
    await expect(pending.filter({ hasText: CREW_ONLY })).toContainText('Expires in 7 days');
    await expect(pending.filter({ hasText: TYPO })).toBeVisible();
    await expect(pending.filter({ hasText: DECLINER })).toBeVisible();
  });
  await flow.shot('pending');

  await pending.filter({ hasText: TYPO }).getByRole('button', { name: 'Revoke' }).click();
  await flow.check(14, 'Revoke asks first: "Revoke this invite? They won’t be able to accept it."', async () => {
    await expect(pending.filter({ hasText: TYPO })).toContainText("Revoke this invite? They won't be able to accept it.");
  });
  await flow.shot('revoke-confirm');
  await pending.filter({ hasText: TYPO }).getByRole('button', { name: 'Revoke invite' }).click();
  await flow.check(15, 'After "Revoke invite" the mistyped invite is gone (screen and database); the other stays', async () => {
    await expect(pending.filter({ hasText: TYPO })).toHaveCount(0);
    await expect(pending.filter({ hasText: CREW_ONLY })).toBeVisible();
    const { data } = await a.from('invites').select('id').eq('venue_id', MARKTZAAL).ilike('email', TYPO);
    expect(data).toEqual([]);
  });

  // ── A crew-only account (no company) accepts on /onboarding (finding 3) ──
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(CREW_ONLY)}&next=/app`);
  await page.waitForURL(/\/onboarding/);
  await flow.check(16, 'No company yet: login accepted nothing and shows the invite, not company setup', async () => {
    await expect(page.getByText("You've been invited")).toBeVisible();
    await expect(page.getByText(`Crew · ${CREW_EVENT_NAME} at De Marktzaal`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Set up my own company instead' })).toBeVisible();
    const crewOnlyId = (await getUserIdByEmail(CREW_ONLY)) ?? '';
    const { data } = await a.from('event_organizers').select('event_id').eq('user_id', crewOnlyId);
    expect(data).toEqual([]);
  });
  await flow.shot('onboarding-crew-invite');

  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.waitForURL(/\/app/);
  await page.goto(new URL('/app/events', baseURL).toString());
  await flow.check(17, 'After accept they land in the app with their event, no own company, no Marktzaal membership', async () => {
    await expect(page.getByText(CREW_EVENT_NAME).first()).toBeVisible();
    await expect(page.getByText(OTHER_EVENT_NAME)).toHaveCount(0);
    const crewOnlyId = (await getUserIdByEmail(CREW_ONLY)) ?? '';
    const { data: mem } = await a.from('venue_memberships').select('venue_id').eq('user_id', crewOnlyId);
    expect(mem).toEqual([]);
  });
  await flow.shot('crew-only-events');
  await flow.check(18, 'Crew-only screens: no link opens a new window, no sideways scroll', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });

  // ── An account with no company DECLINES on /onboarding ───────────────────
  const declinerId = (await getUserIdByEmail(DECLINER)) ?? '';
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(DECLINER)}&next=/app`);
  await page.waitForURL(/\/onboarding/);
  await expect(page.getByText(`Crew · ${CREW_EVENT_NAME} at De Marktzaal`)).toBeVisible();
  await flow.shot('decliner-invite');
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await flow.check(19, 'Decline says so: "You declined the invite from De Marktzaal."', async () => {
    await expect(page.getByRole('status')).toHaveText("You declined the invite from De Marktzaal. We'll let them know.");
  });
  await flow.shot('declined');
  await flow.check(20, 'After decline, in the database: the invite is closed (declined_at set), no crew row, no membership', async () => {
    const { data: inv } = await a.from('invites').select('declined_at, accepted_at').eq('venue_id', MARKTZAAL).ilike('email', DECLINER);
    expect(inv).toHaveLength(1);
    expect(inv?.[0]?.declined_at).not.toBeNull();
    expect(inv?.[0]?.accepted_at).toBeNull();
    const { data: org } = await a.from('event_organizers').select('event_id').eq('user_id', declinerId);
    expect(org).toEqual([]);
    const { data: mem } = await a.from('venue_memberships').select('venue_id').eq('user_id', declinerId);
    expect(mem).toEqual([]);
  });
  await flow.check(21, 'After the last decline the way on is "Set up my own company"', async () => {
    await expect(page.getByRole('button', { name: 'Set up my own company' })).toBeVisible();
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/events/${CREW_EVENT}/crew`);
  await page.waitForURL(new RegExp(`/app/events/${CREW_EVENT}/crew`));
  await flow.check(22, "The admin's \"Waiting to accept\" list no longer shows the declined invite", async () => {
    await expect(pending.filter({ hasText: CREW_ONLY })).toBeVisible();
    await expect(pending.filter({ hasText: DECLINER })).toHaveCount(0);
  });
});
