import { test, expect, type Page } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { loginWithMfa } from './helpers/mfa';
import { clearMfaFactors, getDefaultQuota, setDefaultQuota } from './helpers/supabase-admin';

// Fase 5 — venue dashboard, happy path per role (spec §2 role matrix, #24).
// Requires the local stack (supabase start + dev server + Inbucket), like the
// other e2e specs. Club Vesper from the seed; ?venue= pins it for the admin who
// belongs to two venues.
const VENUE = 'aa000000-0000-7000-8000-000000000001';
const ADMIN = 'admin@plusone.test';
const FINANCE = 'finance@plusone.test';
const MANAGER = 'manager@plusone.test';
const STAFF = 'staff@plusone.test';

async function settle(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.startsWith('/login') && !url.pathname.startsWith('/auth'), {
    timeout: 20_000,
  });
}

test.describe('admin — full venue dashboard (MFA)', () => {
  test.beforeEach(() => clearMfaFactors(ADMIN));
  test.afterEach(async () => {
    await clearMfaFactors(ADMIN);
    await setDefaultQuota(STAFF, VENUE, 10); // restore the seed value
  });

  test('admin edits a default quota and sees full team controls', async ({ page }) => {
    await loginWithMfa(page, ADMIN);

    await page.goto(`/admin/venue?venue=${VENUE}`);
    await expect(page.getByRole('heading', { name: 'Venue-instellingen' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Standaard-toelages/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Instellingen opslaan' })).toBeVisible();

    // Set Tom's default quota and verify it actually persisted in the DB.
    const tomRow = page.locator('li', { hasText: 'Tom Bakker' });
    await tomRow.getByRole('spinbutton').fill('15');
    await tomRow.getByRole('button', { name: 'Opslaan' }).click();
    await expect(tomRow.getByText('Toelage opgeslagen.')).toBeVisible();
    expect(await getDefaultQuota(STAFF, VENUE)).toBe(15);

    // Team screen exposes the manage controls for an AAL2 admin.
    await page.goto(`/admin/team?venue=${VENUE}`);
    await expect(page.getByRole('heading', { name: 'Gebruiker uitnodigen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rollen wijzigen' }).first()).toBeVisible();
  });
});

test.describe('finance — same screens, read-only (MFA)', () => {
  test.beforeEach(() => clearMfaFactors(FINANCE));
  test.afterEach(() => clearMfaFactors(FINANCE));

  test('finance sees settings + team but cannot edit anything', async ({ page }) => {
    await loginWithMfa(page, FINANCE);

    await page.goto(`/admin/venue?venue=${VENUE}`);
    await expect(page.getByRole('heading', { name: 'Venue-instellingen' })).toBeVisible();
    await expect(page.getByLabel('Venuenaam')).toBeDisabled();
    // No save button anywhere on the page → quota rows are plain numbers too.
    await expect(page.getByRole('button', { name: 'Instellingen opslaan' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Opslaan' })).toHaveCount(0);

    await page.goto(`/admin/team?venue=${VENUE}`);
    await expect(page.getByText('Tom Bakker')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Gebruiker uitnodigen' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Rollen wijzigen' })).toHaveCount(0);
    await expect(page.getByText('alleen-lezen').first()).toBeVisible();
  });
});

test.describe('user_manager — team without MFA is read-only until step-up', () => {
  test('manager sees members + the MFA-required notice, and no Venue link', async ({ page }) => {
    await otpLogin(page, MANAGER);
    await settle(page);

    await page.goto(`/admin/team?venue=${VENUE}`);
    await expect(page.getByText('Tom Bakker')).toBeVisible();
    await expect(page.getByText('MFA vereist om gebruikers te beheren')).toBeVisible();

    // user_manager is not admin/finance → no venue-settings entry point.
    await expect(page.getByRole('link', { name: 'Team' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Venue' })).toHaveCount(0);
  });
});

test.describe('staff — no venue dashboard', () => {
  test('staff is denied team and venue screens and gets no nav entries', async ({ page }) => {
    await otpLogin(page, STAFF);
    await settle(page);

    await page.goto(`/admin/team?venue=${VENUE}`);
    await expect(page.getByText('Je hebt geen toegang tot teambeheer voor een venue.')).toBeVisible();

    await page.goto(`/admin/venue?venue=${VENUE}`);
    await expect(page.getByText('Je hebt geen toegang tot een venue-dashboard.')).toBeVisible();

    await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Venue' })).toHaveCount(0);
  });
});
