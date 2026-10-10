import pg from 'pg';
import { test, expect } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import { ADE_TRIAL_END, adeOfferOpen } from '../../src/features/platform/ade';
import type { Page } from '@playwright/test';

/**
 * Flow (Onboarding A, z8uq9m2vg5): a platform admin invites an address with
 * "Free until end of ADE"; the invitee opens OUR company invite mail from
 * Mailpit (generateLink + the stub provider's Mailpit hand-off, like #430),
 * signs in with its one-time button, walks Welcome → Company (DPA only) → Team
 * and has a trial until 27 Oct 00:00 Amsterdam (or 14 days if later). The
 * trial end is audited on the platform admin and the invite records the
 * company it was used for.
 *
 * After ADE the form no longer offers the toggle: the flow then checks that it
 * is gone and skips the trial-length checks, so it keeps passing (the option
 * itself goes in an expand-contract follow-up).
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

test.describe('ADE platform invite', () => {
  test.beforeAll(async () => {
    await acceptConsent(PLATFORM_ADMIN);
    const id = await getUserIdByEmail(PLATFORM_ADMIN);
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
    if (error) throw new Error(`onboarding ADE setup: ${error.message}`);
    await setPlatformAdmin(true);
  });
  test.afterAll(async () => {
    await setPlatformAdmin(false);
  });

  test('onboarding: ADE platform invite → mail → wizard → trial until the end of ADE', async ({ page, flow }) => {
    const invitee = `flow-ade-${flow.variant}-${Date.now().toString(36)}@plusone.test`;
    const open = adeOfferOpen();
    const company = 'ADE Club';

    await page.goto(`/auth/dev-login?email=${encodeURIComponent(PLATFORM_ADMIN)}&next=/app/platform`);
    await page.waitForURL(/\/app\/platform/);
    await page.getByRole('textbox', { name: 'Email address' }).fill(invitee);
    const toggle = page.getByRole('switch', { name: 'Free until end of ADE' });
    if (open) {
      await expect(page.getByText('Their trial runs through 26 Oct, or 14 days if that is later.')).toBeVisible();
      await toggle.click();
    }
    await flow.shot('platform-invite-ade');

    await flow.check(1, open
      ? 'Platform → Invite with "Free until end of ADE" (through 26 Oct) sends the invite, flag stored'
      : 'After ADE the form no longer offers "Free until end of ADE"; the invite still sends', async () => {
      if (!open) await expect(toggle).toHaveCount(0);
      await page.getByRole('button', { name: 'Send invite' }).click();
      await expect(page.getByText('Invite sent.')).toBeVisible();
      const { data } = await adminClient().from('platform_invites').select('free_until_ade').ilike('email', invitee).single();
      expect(data?.free_until_ade).toBe(open);
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

    const trialQ = 'More → Billing shows a TRIAL (never Always free) ending at 27 Oct 00:00 Amsterdam, or 14 days out if that is later';
    if (open) {
      await flow.check(5, trialQ, async () => {
        await page.goto('/app/more');
        await page.getByText(/^Billing$/).first().click();
        await expect(page.getByText('TRIAL').first()).toBeVisible();
        await expect(page.getByText('ALWAYS FREE')).toHaveCount(0);
        const a = adminClient();
        const { data: inv } = await a.from('platform_invites').select('ade_trial_venue_id').ilike('email', invitee).single();
        const { data: sub } = await a
          .from('subscriptions')
          .select('status, trial_ends_at, created_at')
          .eq('venue_id', inv!.ade_trial_venue_id!)
          .single();
        expect(sub?.status).toBe('trialing');
        const expected = Math.max(ADE_TRIAL_END.getTime(), Date.parse(sub!.created_at) + 14 * 86_400_000);
        expect(Math.abs(Date.parse(sub!.trial_ends_at!) - expected)).toBeLessThan(60_000);
      });
    } else {
      flow.skip(5, trialQ);
    }
    await flow.shot('invitee-billing-trial');

    const auditQ = 'audit_log carries the trial end on the platform admin; the invite records the company';
    if (open) {
      await flow.check(6, auditQ, async () => {
        const a = adminClient();
        const { data: inv } = await a.from('platform_invites').select('ade_trial_venue_id').ilike('email', invitee).single();
        expect(inv?.ade_trial_venue_id).toBeTruthy();
        const adminId = await getUserIdByEmail(PLATFORM_ADMIN);
        const { data: rows } = await a
          .from('audit_log')
          .select('actor_id, entity_type, action')
          .eq('venue_id', inv!.ade_trial_venue_id!)
          .eq('diff->>source', 'platform_invite_ade');
        expect(rows).toEqual([{ actor_id: adminId, entity_type: 'subscriptions', action: 'update' }]);
      });
    } else {
      flow.skip(6, auditQ);
    }

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
