import pg from 'pg';
import { test, expect } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Page } from '@playwright/test';

/**
 * Flow (Onboarding A, z8uq9m2vg5): a platform admin invites an address with
 * "Always free"; the invitee opens OUR company invite mail from Mailpit
 * (generateLink + the stub provider's Mailpit hand-off, like #430), signs in
 * with its one-time button, walks Welcome → Company (DPA only) → Team and sees
 * "Always free" in Billing. The comped decision is audited on the platform
 * admin and the invite records the company it comped.
 *
 * Its own flow file (not a second test in onboarding.flow.ts) because the
 * harness writes one flow.json per flow and variant: a second test would
 * replace the first one's asserts on the contact sheet.
 *
 * Plain seed: admin@ is flipped to platform admin for this flow only. Every
 * variant invites a fresh address, so the 60 s mail window never bites.
 */

const PLATFORM_ADMIN = 'admin@plusone.test';
const PLATFORM_ADMIN_NAME = 'Max de Vries';
const MAILPIT = process.env.INBUCKET_URL || 'http://127.0.0.1:55324';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

/** admin@ is no platform admin on the plain seed (pgTAP relies on that): flip
 *  it for this walk only, through the bootstrap GUC, like platform-billing. */
async function setPlatformAdmin(on: boolean): Promise<void> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await client.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, PLATFORM_ADMIN]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

interface CaughtMail {
  subject: string;
  text: string;
}

/** The newest mail Mailpit caught for `email`, polled: the stub provider hands
 *  it over fire-and-forget. */
async function latestMailTo(email: string): Promise<CaughtMail | null> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=100`);
    const list =
      ((await res.json()) as { messages?: Array<{ ID: string; Subject: string; To?: Array<{ Address: string }> }> })
        .messages ?? [];
    const hit = list.find((m) => (m.To ?? []).some((t) => t.Address.toLowerCase() === email));
    if (hit) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${hit.ID}`)).json()) as { Text?: string };
      return { subject: hit.Subject, text: full.Text ?? '' };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

test.describe('comped platform invite', () => {
  test.beforeAll(async () => {
    await acceptConsent(PLATFORM_ADMIN);
    const id = await getUserIdByEmail(PLATFORM_ADMIN);
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
    if (error) throw new Error(`onboarding comped setup: ${error.message}`);
    await setPlatformAdmin(true);
  });
  test.afterAll(async () => {
    await setPlatformAdmin(false);
  });

  test('onboarding: comped platform invite → mail → wizard → Always free', async ({ page, flow }) => {
    const invitee = `flow-comped-${flow.variant}-${Date.now().toString(36)}@plusone.test`;
    const company = 'ADE Club';

    await page.goto(`/auth/dev-login?email=${encodeURIComponent(PLATFORM_ADMIN)}&next=/app/platform`);
    await page.waitForURL(/\/app\/platform/);
    await page.getByRole('textbox', { name: 'Email address' }).fill(invitee);
    await page.getByRole('switch', { name: 'Always free' }).click();
    await flow.shot('platform-invite-comped');

    await flow.check(1, 'Platform → Invite with "Always free" sends the invite', async () => {
      await page.getByRole('button', { name: 'Send invite' }).click();
      await expect(page.getByText('Invite sent.')).toBeVisible();
      const { data } = await adminClient().from('platform_invites').select('comped').ilike('email', invitee).single();
      expect(data?.comped).toBe(true);
    });
    await flow.shot('platform-invite-sent');

    const mail = await latestMailTo(invitee);
    await flow.check(2, 'Mailpit: "You\'ve been invited to try PlusOne" with the inviter, three steps, one button and the 24-hour validity; no word about free or price', async () => {
      expect(mail?.subject).toBe("You've been invited to try PlusOne");
      expect(mail?.text).toContain(`${PLATFORM_ADMIN_NAME} invited you to run your guest lists on PlusOne.`);
      expect(mail?.text).toMatch(/1\. Tap Get started[\s\S]*2\. Add your company[\s\S]*3\. Create your first event/);
      expect(mail?.text).toContain('expires after 24 hours');
      expect(mail?.text).not.toMatch(/free|price|trial/i);
    });

    const link = mail?.text.match(/\/auth\/confirm\?token_hash=[^\s]+/)?.[0];
    await flow.check(3, "The mail's button signs the invitee in and opens the account consent", async () => {
      expect(link).toBeTruthy();
      await page.context().clearCookies();
      await page.goto(link!);
      await page.waitForURL(/\/consent/);
    });
    await flow.shot('invitee-consent');

    const first = page.getByPlaceholder('First name');
    if (await first.count()) {
      await first.fill('Ade');
      await page.getByPlaceholder('Last name').fill('Owner');
    }
    await agree(page);
    await page.getByRole('button', { name: /Create account|Agree/i }).first().click();
    await page.waitForURL(/\/onboarding/);
    await page.getByRole('button', { name: /Set up account/i }).click();
    await page.getByPlaceholder('e.g. LOFI').fill(company);
    await agree(page);
    await flow.shot('invitee-company');
    await page.getByRole('button', { name: 'Create company' }).click();

    const skipTeam = page.getByRole('button', { name: /Skip for now/i }).first();
    await flow.check(4, 'The invitee walks Welcome → Company → Team, with no plan or payment step', async () => {
      await expect(skipTeam).toBeVisible();
      await expect(page.getByText(/Pick your plan|Set up your payment/i)).toHaveCount(0);
    });
    await skipTeam.click();
    await page.waitForURL(/\/app/);

    await flow.check(5, 'More → Billing shows "Always free" and offers no payment', async () => {
      await page.goto('/app/more');
      await page.getByText(/^Billing$/).first().click();
      await expect(page.getByText('ALWAYS FREE').first()).toBeVisible();
      await expect(page.getByRole('button', { name: /Set up payment/i })).toHaveCount(0);
    });
    await flow.shot('invitee-billing-always-free');

    await flow.check(6, 'audit_log carries the comped decision on the platform admin; the invite records the company', async () => {
      const a = adminClient();
      const { data: inv } = await a.from('platform_invites').select('comped_venue_id').ilike('email', invitee).single();
      expect(inv?.comped_venue_id).toBeTruthy();
      const adminId = await getUserIdByEmail(PLATFORM_ADMIN);
      const { data: rows } = await a
        .from('audit_log')
        .select('actor_id, entity_type')
        .eq('venue_id', inv!.comped_venue_id!)
        .eq('action', 'comped');
      expect(rows).toEqual([{ actor_id: adminId, entity_type: 'subscriptions' }]);
    });

    await flow.check(7, 'No link opens a new window and no uncaught page errors on this walk', async () => {
      await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
      expect(flow.pageErrors).toEqual([]);
    });
  });
});

async function agree(page: Page): Promise<void> {
  const box = page.locator('input[type="checkbox"]');
  if (await box.count()) {
    await box.first().check();
    return;
  }
  await page.getByText(/I agree to the/i).first().click();
}
