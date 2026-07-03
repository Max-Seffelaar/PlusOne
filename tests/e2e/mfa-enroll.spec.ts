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

// MFA is OPTIONAL (#20 refinement 2026-07-02): an admin without a factor gets a
// skippable RECOMMENDATION on app entry. Enrolling voluntarily still works and
// lands them in the app at AAL2.
test('admin sees the MFA recommendation and can enroll voluntarily', async ({ page }) => {
  await otpLogin(page, ADMIN);

  // Recommendation screen (not a hard gate — skip buttons are present).
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Ask me in 7 days/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Don't ask again/i })).toBeVisible();

  const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
  expect(secret, 'enrollment secret should be shown').toBeTruthy();

  await page.getByLabel('Code from your app').fill(totp(secret!));
  await page.getByRole('button', { name: /^Verify$/i }).click();

  // Enrolled → session is AAL2 and the app opens.
  await page.waitForURL('**/app', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/app/);
});
