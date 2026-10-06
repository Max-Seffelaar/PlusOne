import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';

/**
 * Fixed flow: the store-tax guard (#32/#37, Apple 3.1.1/3.1.3, Play payments
 * policy). Inside the native shell, Billing shows status and the one neutral
 * sentence — no price, no payment button, no link, no "pay on the web" pointer.
 * The browser variants are the control: the same screen there DOES offer the
 * price and checkout, which proves the simulation is what switched it off (a
 * broken simulation would otherwise pass the native half silently).
 *
 * Seed state: admin@ on De Marktzaal (venue …0002, `trialing`, no Stripe link),
 * selected through the active-venue cookie. Runs on the plain seed (admin@ has
 * no MFA factor there, and MFA is optional), so no `pnpm dev:mfa` is needed.
 * The unit guards (billing.native.test.tsx, native-store-tax.test.tsx) cover
 * the components; this flow covers the running app.
 */

const TRIAL_VENUE = 'aa000000-0000-7000-8000-000000000002';
const ADMIN = 'admin@plusone.test';

// Same two idempotent writes as the layout suite's global setup: past the
// first-login consent gate and the admin MFA-enroll nudge.
test.beforeAll(async () => {
  await acceptConsent(ADMIN);
  const id = await getUserIdByEmail(ADMIN);
  const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
  if (error) throw new Error(`native-shell guard setup: ${error.message}`);
});

test('native-shell guard: billing is status-only inside the app', async ({ page, context, flow, baseURL }) => {
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: TRIAL_VENUE, domain: host, path: '/' }]);
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/more`);
  await page.waitForURL(/\/app\/more/);

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });
  await expect(page.getByText('De Marktzaal').first()).toBeVisible();
  await flow.shot('more');

  await flow.check(2, 'More: Billing row present; native: no purchase copy anywhere', async () => {
    if (flow.native) await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    await expect(page.getByText(/^Billing$/).first()).toBeVisible();
  });

  await page.goto(new URL('/app/billing', baseURL).toString());
  await expect(page.getByText('TRIAL').first()).toBeVisible();
  await flow.shot('billing');

  if (flow.native) {
    await flow.check(3, 'Billing: native shows "Subscription changes aren\'t available in the app."; browser (control) offers "Set up payment" + payment method', async () => {
      await expect(page.getByText("Subscription changes aren't available in the app.")).toBeVisible();
    });
    await flow.check(4, 'Billing: no price, payment method, checkout or portal copy', async () => {
      await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    });
    await flow.check(5, 'Billing: no payment/checkout/portal button and no outbound link', async () => {
      await expect(page.getByRole('button', { name: /payment|checkout|portal|reactivate|upgrade/i })).toHaveCount(0);
      await expect(page.locator('a[href^="http"]:not([href*="localhost"])')).toHaveCount(0);
    });
  } else {
    // No € here: without STRIPE_SECRET_KEY the stub provider has no price, so
    // the control is the checkout button and the payment-method card.
    await flow.check(3, 'Billing: native shows "Subscription changes aren\'t available in the app."; browser (control) offers "Set up payment" + payment method', async () => {
      await expect(page.getByRole('button', { name: /Set up payment/i })).toBeVisible();
      await expect(page.getByText('SEPA Direct Debit & iDEAL').first()).toBeVisible();
    });
    flow.skip(4, 'Billing: no price, payment method, checkout or portal copy');
    flow.skip(5, 'Billing: no payment/checkout/portal button and no outbound link');
  }

  await flow.check(6, 'No link opens a new browser window (target=_blank)', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  });
  await flow.check(7, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
});
