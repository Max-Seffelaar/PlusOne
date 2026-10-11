import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Flow: Gastcommunicatie F, PR 6b (z8uq9m2vpy): team notification mail and
 * the preferences in Profile, in all four variants.
 *
 *   admin@ → Profile → Notifications: requests, quota, answers, the daily
 *   summary; a change survives a reload → staff@ sees only "Answers to my
 *   requests" → a quota request from staff@ (fixture) is approved by admin@
 *   on the quota tab → Mailpit: the admin got "Tom Bakker wants … more
 *   guests", staff@ got "You got … more guests" (team_quota + team_decision,
 *   sent in after() of the decision) → the decision mail's unsubscribe link
 *   (/n/[token]) asks first, then turns decision mail off.
 *
 * Mail lands through the stub provider's Mailpit hand-off (local stack only).
 * Numbered checks = the ✅ half of this flow's test handoff.
 */

const ADMIN = 'admin@plusone.test';
const STAFF = 'staff@plusone.test';
const EVENT = 'ee000000-0000-7000-8000-000000000001';
const STAFF_ID = '55555555-5555-4555-8555-555555555555';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';

/** The newest Mailpit mail to `email` whose subject matches, polled. */
async function mailTo(email: string, subject: RegExp): Promise<{ subject: string; text: string } | null> {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=200`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; Subject: string; To?: Array<{ Address: string }> }> })
        .messages ?? [];
    const hit = list.find((m) => subject.test(m.Subject) && (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text?: string };
      return { subject: hit.Subject, text: full.Text ?? '' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.beforeAll(async () => {
  for (const email of [ADMIN, STAFF]) {
    await acceptConsent(email);
    const id = await getUserIdByEmail(email);
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
    if (error) throw new Error(`team-mail setup: ${error.message}`);
  }
});

test('team mail: preferences in Profile, quota request + decision mails, unsubscribe', async ({ page, flow }) => {
  // ── admin@ → Profile → Notifications ──────────────────────────────────────
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/profile`);
  await page.waitForURL(/\/app\/profile/);
  const section = page.getByTestId('notification-prefs');
  await expect(section).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await flow.shot('profile-notifications-admin');

  await flow.check(1, 'Admin: Notifications shows guest list requests, quota requests, answers and the daily summary', async () => {
    for (const id of ['prefs-requests', 'prefs-quota', 'prefs-decisions', 'prefs-digest']) {
      await expect(section.getByTestId(id)).toBeVisible();
    }
  });

  // Quota push off, then back on, each surviving a reload.
  const quotaPush = section.getByRole('switch', { name: 'Quota requests: Push' });
  const wasOn = (await quotaPush.getAttribute('aria-checked')) === 'true';
  await quotaPush.click();
  await expect(section.getByText('Saved.')).toBeVisible();
  await page.reload();
  await flow.check(2, 'A change saves and is still there after a reload', async () => {
    await expect(page.getByRole('switch', { name: 'Quota requests: Push' })).toHaveAttribute('aria-checked', String(!wasOn));
  });
  await page.getByRole('switch', { name: 'Quota requests: Push' }).click();
  await expect(page.getByTestId('notification-prefs').getByText('Saved.')).toBeVisible();

  // ── staff@ sees only answers to their own requests ──────────────────────
  await page.context().clearCookies();
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app/profile`);
  await page.waitForURL(/\/app\/profile/);
  const staffSection = page.getByTestId('notification-prefs');
  await expect(staffSection).toBeVisible();
  await staffSection.scrollIntoViewIfNeeded();
  await flow.shot('profile-notifications-staff');
  await flow.check(3, 'Staff: only "Answers to my requests" (no requests, quota or summary)', async () => {
    await expect(staffSection.getByTestId('prefs-decisions')).toBeVisible();
    await expect(staffSection.getByTestId('prefs-requests')).toHaveCount(0);
    await expect(staffSection.getByTestId('prefs-quota')).toHaveCount(0);
    await expect(staffSection.getByTestId('prefs-digest')).toHaveCount(0);
  });

  // ── staff@ asks for more slots (quick-add over quota) ─────────────────────
  // Earlier runs' open requests are set aside (no delete), so the one this run
  // files is the only open one.
  await adminClient()
    .from('quota_requests')
    .update({ status: 'denied', decided_by: '11111111-1111-4111-8111-111111111111', decided_at: new Date().toISOString() } as never)
    .eq('user_id', STAFF_ID)
    .eq('status', 'pending');
  const motivation = `Flow ${flow.variant} ${Date.now().toString(36)}`;
  await page.goto(`/app/events/${EVENT}/add`);
  await page.waitForLoadState('networkidle').catch(() => {});
  // One more than what is left, so the add goes over quota whatever earlier
  // runs approved ("Your quota · N of M left").
  const quotaLine = await page.getByText(/Your quota · \d+ of \d+ left/).first().textContent();
  const left = Number(/· (\d+) of/.exec(quotaLine ?? '')?.[1] ?? '40');
  await page.getByPlaceholder('e.g. "John Doe +2 vip"').fill(`Big Party +${left}`);
  const tierPick = page.getByRole('button', { name: /^Regular/ }).first();
  if (await tierPick.isVisible().catch(() => false)) await tierPick.click();
  await page.getByRole('button', { name: 'Request more slots' }).click();
  await page.getByPlaceholder('Why do you need these slots?').fill(motivation);
  await flow.shot('staff-request-more');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Request sent. An admin will decide on it.')).toBeVisible();
  const { data: qr } = await adminClient()
    .from('quota_requests')
    .select('id, requested_extra')
    .eq('user_id', STAFF_ID)
    .eq('motivation', motivation)
    .single();
  const requestId = (qr as { id: string; requested_extra: number }).id;
  const extra = (qr as { id: string; requested_extra: number }).requested_extra;

  const quotaMail = await mailTo(ADMIN, new RegExp(`wants ${extra} more guests`));
  await flow.check(4, 'The admin got "Tom Bakker wants N more guests for …" with the review button', async () => {
    expect(quotaMail).not.toBeNull();
    expect(quotaMail?.text).toContain(`Tom Bakker asked for ${extra} extra guest spots for PLUSONE Launch Night.`);
    expect(quotaMail?.text).toContain('/app/requests/quota?event=');
  });

  // ── admin@ approves it on the quota tab ───────────────────────────────────
  await page.context().clearCookies();
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=${encodeURIComponent(`/app/requests/quota?event=${EVENT}`)}`);
  await page.waitForURL(/\/app\/requests\/quota/);
  const approve = page.getByRole('button', { name: `Approve +${extra}` }).first();
  await expect(approve).toBeVisible({ timeout: 20_000 });
  await flow.shot('quota-request');
  await approve.click();
  await expect
    .poll(async () => (await adminClient().from('quota_requests').select('status').eq('id', requestId).single()).data?.status)
    .toBe('approved');

  const decisionMail = await mailTo(STAFF, new RegExp(`You got ${extra} more guests`));
  await flow.check(5, 'Staff got the decision: "You got … more guests", with settings and unsubscribe links', async () => {
    expect(decisionMail).not.toBeNull();
    expect(decisionMail?.text).toContain('/app/profile');
    expect(decisionMail?.text).toMatch(/Stop them: \S+\/n\/[A-Za-z0-9_-]{43}/);
  });

  // ── The decision mail's unsubscribe link ──────────────────────────────────
  const unsub = /(\/n\/[A-Za-z0-9_-]{43})/.exec(decisionMail?.text ?? '')?.[1] ?? '/n/missing';
  await page.context().clearCookies();
  await page.goto(unsub);
  await flow.shot('unsubscribe-ask');
  await flow.check(6, 'The unsubscribe link only asks (no login, no change on GET)', async () => {
    await expect(page.getByRole('button', { name: 'Stop these emails' })).toBeVisible();
  });
  await page.getByRole('button', { name: 'Stop these emails' }).click();
  await flow.check(7, 'The button stops that kind of mail: staff@ now has decision mail off', async () => {
    await expect(page.getByText('Emails stopped')).toBeVisible();
    await page.goto(`/auth/dev-login?email=${encodeURIComponent(STAFF)}&next=/app/profile`);
    await page.waitForURL(/\/app\/profile/);
    await expect(
      page.getByTestId('notification-prefs').getByRole('switch', { name: 'Answers to my requests: Email' }),
    ).toHaveAttribute('aria-checked', 'false');
    // Back on for the next run.
    await page.getByTestId('notification-prefs').getByRole('switch', { name: 'Answers to my requests: Email' }).click();
    await expect(page.getByTestId('notification-prefs').getByText('Saved.')).toBeVisible();
  });

  await flow.check(8, 'No sideways scroll and no uncaught page errors', async () => {
    await expectNoHorizontalOverflow(flow);
    expect(flow.pageErrors).toEqual([]);
  });
});
