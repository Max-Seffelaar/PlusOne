import { type Page, expect } from '@playwright/test';
import { clearMailbox, getLatestOtp } from './mail';

// Drives the e-mail OTP login UI: request a code, read it from the mail catcher,
// enter it. The form auto-submits once six digits are present, so navigation
// follows.
export async function otpLogin(page: Page, email: string): Promise<void> {
  await clearMailbox();
  await page.goto('/login');
  await page.getByLabel('E-mailadres').fill(email);
  await page.getByRole('button', { name: /Stuur inlogcode/i }).click();

  const codeInput = page.getByLabel('Inlogcode');
  await expect(codeInput).toBeVisible({ timeout: 15_000 });

  const code = await getLatestOtp(email);
  await codeInput.fill(code); // auto-submits at 6 digits → /auth/callback
}
