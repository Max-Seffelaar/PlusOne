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

// Defense in depth on top of RLS: an admin who has not satisfied MFA cannot
// reach an AAL2-only screen (sessiebeheer). The app guard bounces them to MFA
// rather than ever rendering the sensitive page.
test('a sensitive admin route is unreachable without completing MFA (no AAL2)', async ({ page }) => {
  await otpLogin(page, ADMIN);
  await page.waitForURL('**/mfa/enroll', { timeout: 20_000 });

  // Try to jump straight to the AAL2-only sessions screen.
  await page.goto('/admin/sessions');

  await expect(page).toHaveURL(/\/mfa\/enroll/);
  await expect(page.getByText('Sessies & remote logout')).toHaveCount(0);
});
