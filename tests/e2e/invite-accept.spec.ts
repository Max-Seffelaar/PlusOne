import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';
import { acceptConsent, ensureInvite, resetInvitee, getMembershipRoles } from './helpers/supabase-admin';

const INVITEE = 'e2e-invitee@plusone.test';
const CLUB_VESPER = 'aa000000-0000-7000-8000-000000000001';

test.beforeEach(async () => {
  await resetInvitee(INVITEE, CLUB_VESPER);
  await ensureInvite(INVITEE, CLUB_VESPER, ['staff']);
});

test.afterEach(async () => {
  await resetInvitee(INVITEE, CLUB_VESPER);
});

// Nothing accepts at login (z8uq9m2yvp, decision Max 2026-10-07: data becomes
// visible only once the user has been added AND has accepted). The first OTP login
// only makes the profile; the invitee then accepts the invite themselves on the
// onboarding invite step. Replaces "accepteren = eerste OTP-login" (decision #24).
test('first OTP login accepts nothing; the invitee accepts the invite explicitly', async ({ page }) => {
  await otpLogin(page, INVITEE);

  // The session is up (not bounced to /login) and we land on a gate or onboarding.
  await page.waitForURL(/\/(consent|onboarding|app)/, { timeout: 20_000 });

  // DB truth: the login did NOT turn the invite into a membership.
  expect(await getMembershipRoles(INVITEE, CLUB_VESPER)).toEqual([]);

  // Terms are the one gate that comes first; settle it directly, then open the
  // invite step: no company yet, one open invite.
  await acceptConsent(INVITEE);
  await page.goto('/onboarding');
  await expect(page.getByText('Club Vesper (Staff)')).toBeVisible();
  expect(await getMembershipRoles(INVITEE, CLUB_VESPER)).toEqual([]);

  // The tap is what grants access.
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.waitForURL(/\/app/, { timeout: 20_000 });
  expect(await getMembershipRoles(INVITEE, CLUB_VESPER)).toContain('staff');
});
