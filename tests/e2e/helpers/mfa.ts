import { type Page, expect } from '@playwright/test';
import { otpLogin } from './login';
import { totp } from './totp';

// Logs in AND completes first-time TOTP enrollment, landing the session at AAL2.
// For admin/finance (MFA-mandatory) the app forces enrollment on first login;
// clear the user's factors in beforeEach so this drives the enroll flow cleanly.
export async function loginWithMfa(page: Page, email: string): Promise<void> {
  await otpLogin(page, email);

  await page.waitForURL(/\/mfa\/enroll/, { timeout: 20_000 });
  const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
  expect(secret, 'enrollment secret should be shown').toBeTruthy();

  await page.getByLabel('Code uit je app').fill(totp(secret!));
  await page.getByRole('button', { name: /Activeer MFA/i }).click();

  // AAL2 reached → the app shell opens.
  await page.waitForURL('**/dashboard', { timeout: 20_000 });
}
