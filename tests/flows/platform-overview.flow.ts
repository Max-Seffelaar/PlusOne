import pg from 'pg';
import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Locator, Page } from '@playwright/test';

/**
 * Flow: Platform R (z8uq9m2ybj) — Platform → Overview, Platform → Invites
 * (company chip → Switch), Platform → Companies (same company detail).
 *
 * Runs on the PLAIN seed. admin@ is no platform admin there (pgTAP relies on
 * that), so — exactly like platform-billing — the flow flips the flag through
 * the bootstrap GUC for its own duration and clears it again afterwards.
 *
 * admin@ is a member of both seed companies, and a Switch only writes a
 * platform_access_log row for a company the admin is NOT a member of. So the
 * flow adds one fixture company with a fixed id (idempotent, never deleted —
 * soft-delete only, CLAUDE.md), owned by manager@, and one open platform
 * invite for manager@ (revoked again in afterAll, never deleted).
 */

const ADMIN = 'admin@plusone.test';
const INVITEE = 'manager@plusone.test';
const FIXTURE_VENUE = 'aa000000-0000-7000-8000-0000000000f1';
const FIXTURE_NAME = 'Flow Overview Co';
const PGURL = process.env.PGURL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/postgres';

async function sql<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: PGURL });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

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

async function ensureFixtures(adminId: string, inviteeId: string): Promise<void> {
  await sql(
    `insert into public.venues (id, name, slug) values ($1, $2, 'flow-overview-co')
     on conflict (id) do nothing`,
    [FIXTURE_VENUE, FIXTURE_NAME],
  );
  await sql(
    `insert into public.venue_memberships (venue_id, user_id, roles) values ($1, $2, '{admin}')
     on conflict (venue_id, user_id) do nothing`,
    [FIXTURE_VENUE, inviteeId],
  );
  await sql(
    `insert into public.platform_invites (email, invited_by)
     select $1, $2
     where not exists (
       select 1 from public.platform_invites where lower(email) = lower($1) and revoked_at is null)`,
    [INVITEE, adminId],
  );
}

async function revokeInvite(adminId: string): Promise<void> {
  await sql(
    `update public.platform_invites set revoked_at = now(), revoked_by = $2
      where lower(email) = lower($1) and revoked_at is null`,
    [INVITEE, adminId],
  );
}

let adminId = '';

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const inviteeId = (await getUserIdByEmail(INVITEE)) ?? '';
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (error) throw new Error(`platform-overview setup: ${error.message}`);
  await setPlatformAdmin(true);
  await ensureFixtures(adminId, inviteeId);
});

test.afterAll(async () => {
  await revokeInvite(adminId);
  await setPlatformAdmin(false);
});

function inviteCard(page: Page, email: string): Locator {
  return page.locator('div.rounded-\\[16px\\]').filter({ hasText: email }).first();
}

function tile(section: Locator, label: string): Locator {
  return section.locator('div.rounded-\\[14px\\]').filter({ hasText: label }).first();
}

test('platform-overview: Overview numbers, invite chip → Switch, Companies detail', async ({ page, flow }) => {
  const since = new Date().toISOString();
  // Trial split (20261012150000): same definitions as platform_subscription_counts().
  const [db] = await sql<{ total: number; comped: number; trial_no_payment: number; trial_payment: number }>(
    `select count(*)::int as total,
            count(*) filter (where s.status = 'comped')::int as comped,
            count(*) filter (
              where s.status = 'trialing' and s.stripe_subscription_id is null
                and coalesce(s.trial_ends_at, s.created_at + interval '14 days') >= now())::int as trial_no_payment,
            count(*) filter (
              where s.status = 'trialing' and s.stripe_subscription_id is not null)::int as trial_payment
       from public.venues v left join public.subscriptions s on s.venue_id = v.id`,
  );

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/platform`);
  await page.waitForURL(/\/app\/platform/);

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });

  await flow.check(2, 'Platform shows an Overview entry that opens /app/platform/overview', async () => {
    await page.getByRole('button', { name: /Overview/ }).first().click();
    await page.waitForURL(/\/app\/platform\/overview$/);
  });
  const status = page.getByTestId('platform-overview-status');
  await expect(status).toBeVisible();

  await flow.check(3, 'Companies by status match the database (all companies, always free)', async () => {
    await expect(tile(status, 'All companies')).toContainText(String(db.total));
    await expect(tile(status, 'Always free')).toContainText(String(db.comped));
  });

  await flow.check(11, 'Trial and "Trial, payment set up" split the running trials, matching the database', async () => {
    await expect(status.locator('div.rounded-\\[14px\\]').filter({ hasText: /^\d+Trial$/ })).toHaveText(
      `${db.trial_no_payment}Trial`,
    );
    await expect(tile(status, 'Trial, payment set up')).toContainText(String(db.trial_payment));
    await expect(page.getByText(/Converted means it pays now, past due included\./)).toBeVisible();
  });

  await flow.check(4, 'Trials and last-30-days sections show numbers, no placeholder', async () => {
    await expect(page.getByTestId('platform-overview-trials')).not.toContainText('—');
    await expect(page.getByTestId('platform-overview-usage')).not.toContainText('—');
  });
  await flow.shot('overview');

  await flow.check(5, 'Browser: MRR/ARR read "—" without Stripe, labelled "from our records"; native: no revenue card, no price', async () => {
    if (flow.native) {
      await expect(page.getByTestId('platform-overview-revenue')).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    } else {
      const revenue = page.getByTestId('platform-overview-revenue');
      await expect(revenue).toBeVisible();
      await expect(tile(revenue, 'MRR')).toContainText('—');
      await expect(page.getByText(/From our records, excluding discounts and dunning/)).toBeVisible();
    }
  });

  await page.goto('/app/platform');
  const card = inviteCard(page, INVITEE);
  await flow.check(6, 'The invite for a company owner shows a chip per company with status, events line and Switch', async () => {
    await expect(card).toBeVisible();
    await expect(card.getByText(FIXTURE_NAME)).toBeVisible();
    await expect(card.getByText('Club Vesper')).toBeVisible();
    await expect(card.getByText('No events yet').first()).toBeVisible();
    await expect(card.getByRole('button', { name: `Switch into ${FIXTURE_NAME}` })).toBeVisible();
  });
  await card.scrollIntoViewIfNeeded();
  await flow.shot('invite-chips');

  await flow.check(7, 'Switch lands in that company and writes one platform_access_log row', async () => {
    await card.getByRole('button', { name: `Switch into ${FIXTURE_NAME}` }).click();
    await page.waitForURL(/\/app$/);
    await expect
      .poll(async () =>
        (
          await sql<{ n: number }>(
            `select count(*)::int as n from public.platform_access_log
              where admin_id = $1 and venue_id = $2 and created_at >= $3`,
            [adminId, FIXTURE_VENUE, since],
          )
        )[0].n,
      )
      .toBe(1);
  });
  await flow.shot('switched');

  await page.goto('/app/platform/venues');
  await flow.check(8, 'Companies shows the same detail lines (events, login, check-in)', async () => {
    const venue = page.locator('div.rounded-\\[16px\\]').filter({ hasText: FIXTURE_NAME }).first();
    await expect(venue.getByText('No events yet')).toBeVisible();
    await expect(venue.getByText(/never logged in|Last login/)).toBeVisible();
    const vesper = page.locator('div.rounded-\\[16px\\]').filter({ hasText: 'Club Vesper' }).first();
    await expect(vesper.getByText(/^\d+ events? · latest: /)).toBeVisible();
  });
  await flow.shot('companies');

  await flow.check(9, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(10, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
