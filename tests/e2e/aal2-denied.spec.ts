import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { clearMfaFactors } from './helpers/supabase-admin';

const ADMIN = 'admin@plusone.test';

test.beforeEach(async () => {
  await clearMfaFactors(ADMIN);
});
test.afterEach(async () => {
  await clearMfaFactors(ADMIN);
});

// MFA is OPTIONAL (#20 refinement 2026-07-02) — deliberate rewrite of the old
// "sensitive route is unreachable without AAL2" case. An admin WITHOUT a factor
// snoozes the recommendation once and then uses the app freely; the
// recommendation does not come back within the snooze window.
test('admin without MFA snoozes the recommendation and reaches the app', async ({ page }) => {
  await otpLogin(page, ADMIN);

  // The skippable recommendation appears once (no factor, nothing snoozed yet).
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  await page.getByRole('button', { name: /Ask me in 7 days/i }).click();

  // Snoozed → the app opens at AAL1; no bounce back to the recommendation.
  await page.waitForURL('**/app', { timeout: 20_000 });
  await page.goto('/app');
  await expect(page).toHaveURL(/\/app/);
});
