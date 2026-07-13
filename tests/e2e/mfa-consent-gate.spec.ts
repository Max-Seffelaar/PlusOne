import { test, expect } from '@playwright/test';
import { clearMfaFactors, clearConsent, acceptConsent } from './helpers/supabase-admin';
import { totp } from './helpers/totp';

const ADMIN = 'admin@plusone.test';

// Deep-link gap fixed 2026-07-13 (fresh-session review of PR #187, ClickUp
// 86ey7qkkb): /mfa/enroll and /mfa/verify sit outside the /app layout, which is
// where the first-login consent gate (#20/#40) used to live exclusively. A
// signed-in user who had not yet accepted Terms + Privacy could deep-link
// straight to either MFA route and enroll/verify before ever seeing /consent.
// Both pages now call requireConsent first (mirrors the order in
// src/app/app/layout.tsx: consent before the MFA recommendation).

test.beforeEach(async () => {
  await clearMfaFactors(ADMIN);
});
test.afterEach(async () => {
  await clearMfaFactors(ADMIN);
  await acceptConsent(ADMIN);
});

test('deep-linking to /mfa/enroll without consent bounces to /consent', async ({ page }) => {
  // First hit of /app in a freshly started dev server compiles the whole
  // route (PoLiveProvider + shell) before the layout's redirect fires — same
  // cold-start cost documented in core-flow.spec.ts.
  test.setTimeout(180_000);
  await clearConsent(ADMIN);

  // aal1=1 skips dev-login's best-effort MFA auto-complete — irrelevant here
  // since clearMfaFactors already left the account with no factor.
  await page.goto(`/auth/dev-login?email=${ADMIN}&aal1=1&next=/app`);
  await page.waitForURL(/\/consent/, { timeout: 60_000 });

  // Now deep-link straight to /mfa/enroll, as if bookmarked or hand-typed.
  await page.goto('/mfa/enroll?next=%2Fapp');
  await expect(page).toHaveURL(/\/consent\?next=%2Fapp/);
  await expect(page.getByTestId('totp-secret')).toHaveCount(0);
});

test('deep-linking to /mfa/verify without consent bounces to /consent', async ({ page }) => {
  // Same cold-start margin as the enroll test above — /app and /mfa/enroll may
  // still need a first-hit compile if this test runs in isolation.
  test.setTimeout(180_000);
  // Enroll a verified factor first (consent accepted so the enroll flow itself
  // isn't blocked), then revoke consent to simulate a re-required acceptance
  // (e.g. TERMS_VERSION bump) on an account that already has MFA set up.
  await acceptConsent(ADMIN);
  await page.goto(`/auth/dev-login?email=${ADMIN}&aal1=1&next=${encodeURIComponent('/mfa/enroll?next=%2Fapp')}`);
  await page.waitForURL(/\/mfa\/enroll/, { timeout: 60_000 });

  const secret = (await page.getByTestId('totp-secret').textContent())?.trim();
  expect(secret, 'enrollment secret should be shown').toBeTruthy();
  await page.getByLabel('Code from your app').fill(totp(secret!));
  await page.getByRole('button', { name: /^Verify$/i }).click();
  await page.waitForURL('**/app', { timeout: 60_000 });

  await clearConsent(ADMIN);

  // Session is AAL2 with a verified factor — /mfa/verify would normally just
  // forward straight to `next`. The consent gate must still intercept first.
  await page.goto('/mfa/verify?next=%2Fapp');
  await expect(page).toHaveURL(/\/consent\?next=%2Fapp/);
  await expect(page.getByText("Verify it's you")).toHaveCount(0);
});
