import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { test, expect, expectNoHorizontalOverflow } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Last-admin guard (onboarding task 0g): a company always keeps one admin.
 *
 * Seed: admin@ (Max de Vries) is the ONLY admin of Club Vesper; manager@
 * (Noor van Dijk) is its user_manager. (manager@ is not an admin in the seed,
 * and a user_manager can't touch an admin row at all, so admin@ is the persona
 * that exercises this.)
 *
 *  Q1-Q3  admin@ opens their own Team sheet: no "Revoke access", the Admin chip
 *         is locked ("only admin"), a hint says why.
 *  Q4     a non-admin member's sheet (Noor) is unchanged: Revoke offered, no hint.
 *  Q5-Q6  once Noor is made admin too (fixture), Max's sheet offers Revoke and
 *         a free Admin chip again.
 *  Q7     the API refusal: admin@'s own session deleting their own row through
 *         PostgREST gets SQLSTATE P0LA1 and the row stays.
 *  Q8     no sideways scroll, no target=_blank.
 *
 * Every variant resets Noor to {user_manager}; afterAll does it again and
 * restores admin@'s MFA snooze, so the shared plain seed is left as found.
 */

const VESPER = 'aa000000-0000-7000-8000-000000000001';
const ADMIN = 'admin@plusone.test';
const ADMIN_NAME = 'Max de Vries';
const MANAGER = 'manager@plusone.test';
const MANAGER_NAME = 'Noor van Dijk';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let adminSnoozeBefore: string | null = null;

async function setNoorRoles(roles: string[]): Promise<void> {
  const a = adminClient();
  const noor = (await getUserIdByEmail(MANAGER)) ?? '';
  const { error } = await a.from('venue_memberships').update({ roles }).eq('venue_id', VESPER).eq('user_id', noor);
  if (error) throw new Error(`last-admin flow fixture (Noor roles): ${error.message}`);
}

/** A user-scoped client signed in as `email` (magic link minted with the service
 *  role, verified on the anon key): the same REST role a browser session has. */
async function userClient(email: string): Promise<SupabaseClient> {
  const { data, error } = await adminClient().auth.admin.generateLink({ type: 'magiclink', email });
  if (error || !data.properties?.hashed_token) throw new Error(`last-admin flow: magic link for ${email} failed`);
  const c = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error: vErr } = await c.auth.verifyOtp({ type: 'magiclink', token_hash: data.properties.hashed_token });
  if (vErr) throw new Error(`last-admin flow: verify for ${email} failed`);
  return c;
}

test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  const { data: prof } = await a.from('user_profiles').select('mfa_snooze_until').eq('id', adminId).maybeSingle();
  adminSnoozeBefore = prof?.mfa_snooze_until ?? null;
  const { error } = await a.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', adminId);
  if (error) throw new Error(`last-admin flow setup: ${error.message}`);
});

test.afterAll(async () => {
  await setNoorRoles(['user_manager']);
  const a = adminClient();
  const adminId = (await getUserIdByEmail(ADMIN)) ?? '';
  await a.from('user_profiles').update({ mfa_snooze_until: adminSnoozeBefore }).eq('id', adminId);
});

test('team: the only admin cannot remove themselves or drop the admin role', async ({ page, context, flow, baseURL }) => {
  await setNoorRoles(['user_manager']);
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: VESPER, domain: host, path: '/' }]);

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/team`);
  await page.waitForURL(/\/app\/team/);
  await expect(page.getByRole('button', { name: `Manage ${ADMIN_NAME}` })).toBeVisible();
  await flow.shot('team');

  // ── admin@ is the only admin: their own sheet ────────────────────────────
  await page.getByRole('button', { name: `Manage ${ADMIN_NAME}` }).click();
  const revoke = page.getByRole('button', { name: 'Revoke access to this company' });
  const adminChip = page.getByRole('button', { name: /^Admin/ });
  await flow.check(1, 'The only admin opening their own sheet sees no "Revoke access to this company"', async () => {
    await expect(page.getByRole('button', { name: 'Save roles' })).toBeVisible();
    await expect(revoke).toHaveCount(0);
  });
  await flow.check(2, 'Their Admin chip is on, locked and marked "only admin"', async () => {
    await expect(adminChip).toBeDisabled();
    await expect(adminChip).toHaveAttribute('aria-pressed', 'true');
    await expect(adminChip).toContainText('only admin');
  });
  await flow.check(3, 'A hint says why: they are the only admin, make someone else admin first', async () => {
    await expect(page.getByText("You're the only admin of this company.", { exact: false })).toBeVisible();
  });
  await flow.shot('self-sheet-only-admin');
  await page.keyboard.press('Escape');
  await page.goto('/app/team');

  // ── a non-admin member's sheet is unchanged ──────────────────────────────
  await page.getByRole('button', { name: `Manage ${MANAGER_NAME}` }).click();
  await flow.check(4, 'A non-admin member (Noor, user_manager) still gets "Revoke access" and no last-admin hint', async () => {
    await expect(revoke).toBeVisible();
    await expect(page.getByText('is the only admin of this company', { exact: false })).toHaveCount(0);
  });
  await flow.shot('member-sheet');

  // ── a second admin lifts the lock ────────────────────────────────────────
  await setNoorRoles(['admin', 'user_manager']);
  await page.goto('/app/team');
  await page.getByRole('button', { name: `Manage ${ADMIN_NAME}` }).click();
  await flow.check(5, 'With Noor as second admin, Max\'s own sheet offers "Revoke access to this company" again', async () => {
    await expect(revoke).toBeVisible();
    await expect(page.getByText("You're the only admin of this company.", { exact: false })).toHaveCount(0);
  });
  await flow.check(6, 'and the Admin chip can be switched off (no "only admin")', async () => {
    await expect(adminChip).toBeEnabled();
    await expect(adminChip).not.toContainText('only admin');
  });
  await flow.shot('self-sheet-two-admins');
  await setNoorRoles(['user_manager']);

  // ── the API refuses it regardless of the UI ──────────────────────────────
  await flow.check(7, 'Through the API, admin@ deleting their own (last-admin) row gets P0LA1 and the row stays', async () => {
    const max = (await getUserIdByEmail(ADMIN)) ?? '';
    const c = await userClient(ADMIN);
    const { error } = await c.from('venue_memberships').delete().eq('venue_id', VESPER).eq('user_id', max);
    expect(error?.code).toBe('P0LA1');
    const { data } = await adminClient().from('venue_memberships').select('roles').eq('venue_id', VESPER).eq('user_id', max).maybeSingle();
    expect(data?.roles).toContain('admin');
  });

  await flow.check(8, 'Team screen and sheets: no sideways scroll, no link opens a new window', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    expectNoHorizontalOverflow(flow);
  });
});
