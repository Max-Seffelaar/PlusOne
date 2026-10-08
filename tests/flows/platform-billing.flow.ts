import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Locator, Page } from '@playwright/test';

/**
 * Flow: Platform → Companies → trial / always free (Billing G, decision #32(d)).
 * A platform admin sets De Marktzaal to "Always free", back to a fresh 14-day
 * trial, and extends the trial to a picked day; every change lands in audit_log
 * on the admin's own uid (the subscriptions trigger, decision #4).
 *
 * Runs on the PLAIN seed: admin@ is no platform admin there (pgTAP relies on
 * that), so this flow flips the flag through the bootstrap GUC for its own
 * duration (direct DB, local stack only — the same write `pnpm dev:mfa` does)
 * and clears it again afterwards. De Marktzaal's subscription is reset to a
 * fresh trial before every variant and after the run.
 */

const ADMIN = 'admin@plusone.test';
const MARKTZAAL = 'aa000000-0000-7000-8000-000000000002';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function setPlatformAdmin(on: boolean): Promise<void> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    await client.query('begin');
    await client.query("select set_config('plusone.platform_admin_write', 'on', true)");
    await client.query('update public.user_profiles set is_platform_admin = $1 where email = $2', [on, ADMIN]);
    await client.query('commit');
  } finally {
    await client.end();
  }
}

async function resetMarktzaal(): Promise<void> {
  const { error } = await adminClient()
    .from('subscriptions')
    .update({ status: 'trialing', created_at: new Date().toISOString(), trial_ends_at: null })
    .eq('venue_id', MARKTZAAL);
  if (error) throw new Error(`platform-billing reset: ${error.message}`);
}

async function subscription(): Promise<{ status: string; trial_ends_at: string | null }> {
  const { data, error } = await adminClient()
    .from('subscriptions')
    .select('status, trial_ends_at')
    .eq('venue_id', MARKTZAAL)
    .single();
  if (error || !data) throw new Error(`platform-billing read: ${error?.message}`);
  return data;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`platform-billing setup: ${error.message}`);
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

test('platform-billing: Platform → Companies → always free / trial until', async ({ page, flow }) => {
  const adminId = await getUserIdByEmail(ADMIN);
  const since = new Date().toISOString();

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/platform/venues`);
  await page.waitForURL(/\/app\/platform\/venues/);
  const marktzaal = card(page, 'De Marktzaal');
  await expect(marktzaal).toBeVisible();

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });
  await flow.check(2, 'De Marktzaal reads "Trial · N days left", "Always free" off; Club Vesper reads "Always free"', async () => {
    await expect(marktzaal.getByText(/^Trial · \d+ days left$/)).toBeVisible();
    await expect(marktzaal.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(card(page, 'Club Vesper').getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
  await flow.shot('companies');

  await flow.check(3, '"Always free" on → chip "Always free", DB status comped', async () => {
    await marktzaal.getByRole('switch').click();
    await expect(marktzaal.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    await expect(marktzaal.getByText('Always free').first()).toBeVisible();
    expect((await subscription()).status).toBe('comped');
  });
  await flow.shot('always-free-on');

  await flow.check(4, '"Always free" off → trialing again, trial ends today + 14 days', async () => {
    await marktzaal.getByRole('switch').click();
    await expect(marktzaal.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    await expect(marktzaal.getByText(/^Trial · \d+ days left$/)).toBeVisible();
    const sub = await subscription();
    expect(sub.status).toBe('trialing');
    const days = (new Date(sub.trial_ends_at ?? 0).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(13.9);
    expect(days).toBeLessThan(14.1);
  });

  const target = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await flow.check(5, '"Set trial end" stores the picked day (end of that day, Amsterdam); chip reads the new countdown', async () => {
    await marktzaal.locator('input[type="date"]').fill(target);
    await marktzaal.getByRole('button', { name: /Set trial end/ }).click();
    await expect
      .poll(async () => (await subscription()).trial_ends_at?.slice(0, 10))
      .toBe(target);
    await expect(marktzaal.getByText(/^Trial · \d+ days left$/)).toBeVisible();
  });
  await flow.shot('trial-extended');

  await flow.check(6, 'audit_log holds the three changes on the platform admin\'s uid', async () => {
    const { data, error } = await adminClient()
      .from('audit_log')
      .select('id')
      .eq('entity_type', 'subscriptions')
      .eq('venue_id', MARKTZAAL)
      .eq('actor_id', adminId ?? '')
      .gte('created_at', since);
    expect(error).toBeNull();
    expect(data?.length).toBe(3);
  });

  await flow.check(7, 'No price or purchase copy on the Platform screen (both surfaces)', async () => {
    await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
  });
  await flow.check(8, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(9, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
