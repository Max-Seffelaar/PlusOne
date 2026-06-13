import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { clearMfaFactors } from './helpers/supabase-admin';
import { totp } from './helpers/totp';

const ADMIN = 'admin@plusone.test';

test.beforeEach(async () => {
  await clearMfaFactors(ADMIN);
});
test.afterEach(async () => {
  await clearMfaFactors(ADMIN);
});

// MFA is mandatory for admin (CLAUDE.md §Auth): first login forces enrollment,
// and verifying the TOTP raises the session to AAL2 so the app opens.
test('admin is forced to enroll TOTP and then reaches the app at AAL2', async ({ page }) => {
  await otpLogin(page, ADMIN);

  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });

  const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
  expect(secret, 'enrollment secret should be shown').toBeTruthy();

  await page.getByLabel('Code uit je app').fill(totp(secret!));
  await page.getByRole('button', { name: /Activeer MFA/i }).click();

  // AAL2 reached → the middleware MFA gate now lets the protected route through.
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/dashboard/);
});
