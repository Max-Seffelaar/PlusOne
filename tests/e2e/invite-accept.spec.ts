import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { ensureInvite, resetInvitee } from './helpers/supabase-admin';

const INVITEE = 'e2e-invitee@plusone.test';
const CLUB_VESPER = 'aa000000-0000-7000-8000-000000000001';

test.beforeEach(async () => {
  await resetInvitee(INVITEE, CLUB_VESPER);
  await ensureInvite(INVITEE, CLUB_VESPER, ['staff']);
});

test.afterEach(async () => {
  await resetInvitee(INVITEE, CLUB_VESPER);
});

// "Accepteren = eerste OTP-login" (decision #24): the first login provisions the
// invitee's profile + venue membership, which then shows up on the dashboard.
test('first OTP login accepts the pending invite and grants venue access', async ({ page }) => {
  await otpLogin(page, INVITEE);

  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page.getByText('Club Vesper')).toBeVisible();
  await expect(page.getByText('Personeel')).toBeVisible();
});
