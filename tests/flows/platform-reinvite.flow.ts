import pg from 'pg';
import { test, expect } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Page } from '@playwright/test';

/**
 * Flow (z8uq9m5enh): "Send invite" on an address that already has an open
 * platform invite re-sends that invite instead of refusing it (Sentry
 * SENTRY-CITRON-CLOUD-D). Inside the 60-second per-address mail window the
 * second send gets the rate-limit copy and sends nothing; after it, a green
 * "Already invited. Sent the invite again.", a second mail in Mailpit and a
 * bumped last_sent_at on the ONE open row. A double click on "Send invite"
 * sends one invite.
 *
 * Plain seed: admin@ is flipped to platform admin for this flow only (like
 * onboarding-ade-trial). Every variant uses fresh addresses, so variants never
 * share a mail window; the 60 s window is waited out, never tampered with
 * (mail_log is closed to every app role). The per-admin invite budget (20/h)
 * is reset per variant like guest-info resets its status-read bucket: four
 * variants × four sends would otherwise run into it on a second run.
 */

const PLATFORM_ADMIN = 'admin@plusone.test';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function withPg<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setPlatformAdmin(on: boolean): Promise<void> {
  await withPg(async (c) => {
    await c.query('begin');
    await c.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await c.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, PLATFORM_ADMIN]);
    await c.query('commit');
  });
}

/** How many mails Mailpit holds for `email` (polled up to `want`). */
async function mailCount(email: string, want: number): Promise<number> {
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}&limit=50`);
    n = ((await res.json()) as { messages_count?: number }).messages_count ?? 0;
    if (n >= want) return n;
    await new Promise((r) => setTimeout(r, 500));
  }
  return n;
}

interface OpenRow {
  id: string;
  note: string | null;
  last_sent_at: string;
}

async function openRows(email: string): Promise<OpenRow[]> {
  const { data, error } = await adminClient()
    .from('platform_invites')
    .select('id, note, last_sent_at')
    .ilike('email', email)
    .is('revoked_at', null);
  if (error) throw new Error(error.message);
  return data ?? [];
}

async function sendInvite(page: Page, email: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Email address' }).fill(email);
  await page.getByRole('button', { name: 'Send invite' }).click();
}

const sendStatus = (page: Page) => page.getByRole('status').filter({ hasText: /Invite sent|Already invited/ });
const sendAlert = (page: Page) => page.getByRole('alert');

test.describe('platform re-invite', () => {
  let adminId = '';
  test.beforeAll(async () => {
    await acceptConsent(PLATFORM_ADMIN);
    adminId = (await getUserIdByEmail(PLATFORM_ADMIN)) ?? '';
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
    if (error) throw new Error(`platform-reinvite setup: ${error.message}`);
    await setPlatformAdmin(true);
  });
  test.beforeEach(async () => {
    await withPg((c) => c.query('delete from public.landing_request_throttle where ip_hash = $1', [`pinv:${adminId}`]));
  });
  test.afterAll(async () => {
    // Revoke (never delete) what this flow opened, then drop the flag.
    await withPg((c) =>
      c.query(
        `update public.platform_invites set revoked_at = now(), revoked_by = $1
          where email like 'flow-reinvite-%@plusone.test' and revoked_at is null`,
        [adminId],
      ),
    );
    await setPlatformAdmin(false);
  });

  test('platform-reinvite: same address twice re-sends; inside 60 s it is rate-limited; double click sends once', async ({ page, flow }) => {
    test.setTimeout(240_000);
    const stamp = `${flow.variant}-${Date.now().toString(36)}`;
    const invitee = `flow-reinvite-${stamp}@plusone.test`;
    const doubled = `flow-reinvite-dbl-${stamp}@plusone.test`;

    await page.goto(`/auth/dev-login?email=${encodeURIComponent(PLATFORM_ADMIN)}&next=/app/platform`);
    await page.waitForURL(/\/app\/platform/);

    await sendInvite(page, invitee);
    await flow.check(1, 'A new address: "Invite sent.", one open row, one mail in Mailpit', async () => {
      await expect(sendStatus(page)).toHaveText('Invite sent.');
      expect(await openRows(invitee)).toHaveLength(1);
      expect(await mailCount(invitee, 1)).toBe(1);
    });
    const [first] = await openRows(invitee);
    const sentAt = Date.now();
    await flow.shot('invite-sent');

    await sendInvite(page, invitee);
    await flow.check(2, 'Same address again within 60 s: the rate-limit message, no second mail, last_sent_at unchanged', async () => {
      await expect(sendAlert(page)).toHaveText('Too many invite emails just now. Try again in a bit.');
      expect(await mailCount(invitee, 2)).toBe(1);
      const rows = await openRows(invitee);
      expect(rows).toHaveLength(1);
      expect(rows[0].last_sent_at).toBe(first.last_sent_at);
    });
    await flow.shot('reinvite-rate-limited');

    // Wait out the per-address window (mail_recipient_window(), 60 s).
    const wait = sentAt + 62_000 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);

    await sendInvite(page, invitee);
    await flow.check(3, 'Same address after the window: green "Already invited. Sent the invite again.", a second mail, last_sent_at bumped on the one open row, form cleared', async () => {
      await expect(sendStatus(page)).toHaveText('Already invited. Sent the invite again.');
      await expect(page.getByRole('textbox', { name: 'Email address' })).toHaveValue('');
      expect(await mailCount(invitee, 2)).toBe(2);
      const rows = await openRows(invitee);
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(first.id);
      expect(Date.parse(rows[0].last_sent_at)).toBeGreaterThan(Date.parse(first.last_sent_at));
    });
    await flow.shot('reinvite-sent');

    await flow.check(4, 'audit_log records the re-send as one last_sent_at update on the platform admin', async () => {
      const rows = await withPg(async (c) =>
        (
          await c.query<{ actor_id: string }>(
            `select actor_id
               from public.audit_log
              where entity_type = 'platform_invites' and entity_id = $1 and action = 'update'`,
            [first.id],
          )
        ).rows,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor_id).toBe(adminId);
    });

    await page.getByRole('textbox', { name: 'Email address' }).fill(doubled);
    // Two clicks inside one task: the stale-closure case a ref guard exists for.
    await page.getByRole('button', { name: 'Send invite' }).evaluate((b: HTMLElement) => {
      b.click();
      b.click();
    });
    await flow.check(5, 'A double click on "Send invite" for a new address: one row and one mail', async () => {
      await expect(sendStatus(page)).toHaveText('Invite sent.');
      expect(await openRows(doubled)).toHaveLength(1);
      expect(await mailCount(doubled, 2)).toBe(1);
      await expect(sendAlert(page)).toHaveCount(0);
    });
    await flow.shot('double-click-one-invite');

    await flow.check(6, 'No link opens a new window and no uncaught page errors on this walk', async () => {
      await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
      expect(flow.pageErrors).toEqual([]);
    });
  });
});
