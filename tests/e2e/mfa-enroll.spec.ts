import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { clearMfaFactors, primeMfaRecommendation } from './helpers/supabase-admin';
import { totp } from './helpers/totp';

const ADMIN = 'admin@plusone.test';

test.beforeEach(async () => {
  await clearMfaFactors(ADMIN);
  // Ask-first (UX/IA 9/7): the recommendation only fires 24h+ after
  // terms_accepted_at, so backdate it deterministically for this test.
  await primeMfaRecommendation(ADMIN);
});
test.afterEach(async () => {
  await clearMfaFactors(ADMIN);
});

// MFA is OPTIONAL (#20 refinement 2026-07-02): an admin without a factor gets a
// skippable RECOMMENDATION on app entry. Enrolling voluntarily still works and
// lands them in the app at AAL2.
test('admin sees the MFA recommendation and can enroll voluntarily', async ({ page }) => {
  await otpLogin(page, ADMIN);

  // Recommendation screen (not a hard gate — skip buttons are present). Assert
  // on rendered content rather than page.waitForURL: the OTP → /auth/callback
  // → /app → /mfa/enroll redirect chain completes before this line runs, and
  // waitForURL's navigation-event wait can miss an already-settled URL here.
  await expect(page.getByRole('heading', { name: 'Protect your account' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('button', { name: /Ask me in 7 days/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /Don't ask again/i })).toBeVisible();

  // Ask-first (UX/IA 9/7): step 1 is explanation-only — QR/secret only render
  // after opting in via "Set up now".
  await page.getByRole('button', { name: /Set up now/i }).click();

  const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
  expect(secret, 'enrollment secret should be shown').toBeTruthy();

  await page.getByLabel('Code from your app').fill(totp(secret!));
  await page.getByRole('button', { name: /^Verify$/i }).click();

  // Enrolled → session is AAL2 and the app opens.
  await page.waitForURL('**/app', { timeout: 20_000 });
  await expect(page).toHaveURL(/\/app/);
});
