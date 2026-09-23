import { test, expect } from '@playwright/test';
import { acceptConsent, clearConsent } from './helpers/supabase-admin';

const STAFF = 'staff@plusone.test';

// The /app layout's consent gate used to hard-code next=/app (it sits above
// `[[...segments]]`, so it can't see the requested URL). It fires for every
// signed-in user after a TERMS_VERSION bump, so a shared or bookmarked deep link
// opened in that state landed on Home. The middleware now stamps the request
// path into x-po-request-path and the layout uses it as next=. This exercises
// the real middleware → layout header forwarding that the unit tests can only
// simulate. Staff, not admin: the MFA recommendation (admin/finance) must not
// get in the way, and this spec must not touch anyone's MFA factors.

// `staff@plusone.test` is shared with other specs in the one local DB, so the
// restore sits in a `finally` INSIDE each test (plus an afterEach belt): an
// abort between clearConsent and the hook would otherwise leave every later
// staff login stuck on /consent until someone re-seeds (code review 23/9).
test.afterEach(async () => {
  await acceptConsent(STAFF);
});

test('consent re-prompt keeps the deep link and lands back on it', async ({ page }) => {
  // First hit of /app compiles the whole route in a fresh dev server — same
  // cold-start margin as mfa-consent-gate.spec.ts.
  test.setTimeout(180_000);
  await page.goto(`/auth/dev-login?email=${STAFF}&next=/app`);
  await page.waitForURL(/\/app/, { timeout: 60_000 });

  // Simulate a TERMS_VERSION bump on an already signed-in user.
  await clearConsent(STAFF);
  try {
    await page.goto('/app/contacts?q=anna');
    await expect(page).toHaveURL(/\/consent\?next=%2Fapp%2Fcontacts%3Fq%3Danna$/, {
      timeout: 60_000,
    });

    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /Agree & continue/i }).click();
    await page.waitForURL(/\/app\/contacts\?q=anna$/, { timeout: 60_000 });
  } finally {
    await acceptConsent(STAFF);
  }
});

test('a forged x-po-request-path is overwritten by the middleware', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto(`/auth/dev-login?email=${STAFF}&next=/app`);
  await page.waitForURL(/\/app/, { timeout: 60_000 });

  await clearConsent(STAFF);
  try {
    await page.setExtraHTTPHeaders({ 'x-po-request-path': '/app/profile' });
    await page.goto('/app/contacts');
    await expect(page).toHaveURL(/\/consent\?next=%2Fapp%2Fcontacts$/, { timeout: 60_000 });
  } finally {
    await acceptConsent(STAFF);
  }
});
