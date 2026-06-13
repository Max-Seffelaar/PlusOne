import { test, expect } from '@playwright/test';
import { otpLogin } from './helpers/login';

// Staff has no MFA requirement → a successful OTP login lands on the dashboard.
test('staff logs in with an e-mail OTP and lands on the dashboard', async ({ page }) => {
  await otpLogin(page, 'staff@plusone.test');

  await page.waitForURL('**/dashboard', { timeout: 20_000 });
  await expect(page.getByRole('heading', { name: /Hoi/ })).toBeVisible();
  await expect(page.getByText('Club Vesper')).toBeVisible();
});

// The login screen is the only credentialless surface; an anonymous visitor to
// a protected route is redirected there by the middleware.
test('an unauthenticated visit to a protected route redirects to login', async ({ page }) => {
  await page.goto('/dashboard');
  await page.waitForURL('**/login**', { timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Stuur inlogcode/i })).toBeVisible();
});
