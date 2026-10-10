import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Locator, Page } from '@playwright/test';

/**
 * Flow: Billing-mails B1 (z8uq9m2z19). The billing-mail job runs the way
 * pg_cron runs it on prod (a single-use token POSTed to
 * /api/webhooks/billing-mails), De Marktzaal (a fresh trial) gets its welcome
 * mail in Mailpit from support@ with reply-to support@, a second run with the
 * same token is refused, and the Platform → Companies card shows the mail in
 * its "Billing mails" timeline with the next one; "Pause billing mails" is
 * stored on the platform admin's uid.
 *
 * Plain seed; admin@ is made platform admin for the flow's duration (the
 * platform-billing flow's bootstrap GUC) and back afterwards. The welcome mail
 * goes once per company: later variants find it already sent (the job then
 * reports skipped), which is the idempotency this flow also shows.
 */

const ADMIN = 'admin@plusone.test';
const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';
const MAILPIT = process.env.INBUCKET_URL ?? 'http://127.0.0.1:55324';
const WELCOME_SUBJECT = "You're in. De Marktzaal is on PlusOne";

async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function setPlatformAdmin(on: boolean): Promise<void> {
  await withDb(async (client) => {
    await client.query('begin');
    await client.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await client.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, ADMIN]);
    await client.query('commit');
  });
}

/** A token as billing_mails_tick would mint it (hash stored, clear value returned). */
async function mintToken(): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await withDb((client) =>
    client.query("insert into public.billing_mail_tokens (token_hash) values (extensions.digest($1, 'sha256'))", [token])
  );
  return token;
}

async function pausedRow(): Promise<{ paused: boolean; updated_by: string | null } | null> {
  return withDb(async (client) => {
    const r = await client.query('select paused, updated_by from public.billing_mail_settings where venue_id = $1', [
      MARKTZAAL,
    ]);
    return r.rows[0] ?? null;
  });
}

async function resetMarktzaal(): Promise<void> {
  const { error } = await adminClient()
    .from('subscriptions')
    .update({ status: 'trialing', created_at: new Date().toISOString(), trial_ends_at: null })
    .eq('venue_id', MARKTZAAL);
  if (error) throw new Error(`billing-mails reset: ${error.message}`);
}

interface MailpitMessage {
  ID: string;
  Subject: string;
  From: { Address: string };
  To: { Address: string }[];
  ReplyTo: { Address: string }[];
}

async function welcomeMails(): Promise<MailpitMessage[]> {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`subject:"${WELCOME_SUBJECT}"`)}`);
  if (!res.ok) throw new Error(`mailpit ${res.status}`);
  const body = (await res.json()) as { messages: MailpitMessage[] };
  return body.messages.filter((m) => m.Subject === WELCOME_SUBJECT);
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`billing-mails setup: ${error.message}`);
  await setPlatformAdmin(true);
});

test.beforeEach(async () => {
  await resetMarktzaal();
});

test.afterAll(async () => {
  await resetMarktzaal();
  await setPlatformAdmin(false);
});

function card(page: Page, name: string): Locator {
  return page.locator('div.rounded-\\[16px\\]').filter({ hasText: name }).first();
}

test('billing-mails: job → Mailpit → Platform timeline → pause', async ({ page, flow }) => {
  const adminId = await getUserIdByEmail(ADMIN);

  const token = await mintToken();
  await flow.check(1, 'A job run with a fresh token answers 200 with {"ok":true} only (no counts: pg_net keeps responses)', async () => {
    const res = await page.request.post('/api/webhooks/billing-mails', { headers: { 'x-billing-mails-token': token } });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
  await flow.check(2, 'The same token a second time is refused (single use), as is a run without one', async () => {
    const again = await page.request.post('/api/webhooks/billing-mails', { headers: { 'x-billing-mails-token': token } });
    expect(again.status()).toBe(401);
    const none = await page.request.post('/api/webhooks/billing-mails');
    expect(none.status()).toBe(401);
  });
  await flow.check(3, 'Mailpit holds exactly one welcome mail for De Marktzaal, to admin@, from + reply-to support@', async () => {
    await expect.poll(async () => (await welcomeMails()).length).toBe(1);
    const [m] = await welcomeMails();
    expect(m.To.map((t) => t.Address)).toEqual([ADMIN]);
    expect(m.From.Address).toBe('support@plus-one.io');
    expect(m.ReplyTo.map((t) => t.Address)).toEqual(['support@plus-one.io']);
  });

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/platform/venues`);
  await page.waitForURL(/\/app\/platform\/venues/);
  const marktzaal = card(page, 'De Marktzaal');
  await expect(marktzaal).toBeVisible();

  await flow.check(4, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });
  await flow.check(5, '"Billing mails" is collapsed: no pause switch until opened', async () => {
    const toggle = marktzaal.getByRole('button', { name: 'Billing mails for De Marktzaal' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(marktzaal.getByText('Pause billing mails')).toHaveCount(0);
  });
  await flow.shot('companies');

  await flow.check(6, 'Open: the welcome mail with its recipient count, next = "Trial: 7 days left"', async () => {
    await marktzaal.getByRole('button', { name: 'Billing mails for De Marktzaal' }).click();
    await expect(marktzaal.getByText('Welcome, trial started')).toBeVisible();
    await expect(marktzaal.getByText(/^1 recipient · /)).toBeVisible();
    await expect(marktzaal.getByText(/^Next: Trial: 7 days left · /)).toBeVisible();
  });
  await flow.shot('timeline-open');

  await flow.check(7, '"Pause billing mails" on: stored, stamped with the platform admin, next mail gone', async () => {
    const sw = marktzaal.getByRole('switch').last();
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await expect.poll(async () => (await pausedRow())?.paused).toBe(true);
    expect((await pausedRow())?.updated_by).toBe(adminId);
    await expect(marktzaal.getByText('No trial mail left to send.')).toBeVisible();
  });
  await flow.shot('paused');

  await flow.check(8, 'Pause off again: stored', async () => {
    const sw = marktzaal.getByRole('switch').last();
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await expect.poll(async () => (await pausedRow())?.paused).toBe(false);
  });

  await flow.check(9, 'No price or purchase copy on the Platform screen, timeline open', async () => {
    await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
  });
  await flow.check(10, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(11, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
