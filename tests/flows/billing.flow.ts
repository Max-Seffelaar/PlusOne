import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY } from './harness';
import { acceptConsent, adminClient, getUserIdByEmail } from '../e2e/helpers/supabase-admin';
import type { Page, BrowserContext } from '@playwright/test';

/**
 * Flow: More → Billing after Billing G (one plan Pro, monthly or yearly, prices
 * live from Stripe), in all four variants. Browser: admin AND finance pick an
 * interval and reach checkout — locally the stub provider has no prices, so
 * both options read "Price shown at checkout" and the checkout answers "Billing
 * isn't live yet"; a manager sees the status only. Native shell: plan, status,
 * "Trial ends in N days." and the neutral sentence — no price, no interval, no
 * button, no link (store-tax seam #32/#37).
 *
 * Seed (plain): admin@ is the only member of De Marktzaal (…0002, trialing).
 * finance@ and manager@ are members of Club Vesper (…0001), which the seed
 * comps; this flow puts Club Vesper on a running trial for its duration and
 * puts it back to comped afterwards, so finance has something to manage.
 */

const TRIAL_VENUE = 'aa000000-0000-7000-8000-000000000002';
const VESPER = 'aa000000-0000-7000-8000-000000000001';
const USERS = ['admin@plusone.test', 'finance@plusone.test', 'manager@plusone.test'];

test.beforeAll(async () => {
  for (const email of USERS) {
    await acceptConsent(email);
    const id = await getUserIdByEmail(email);
    const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
    if (error) throw new Error(`billing flow setup: ${error.message}`);
  }
  const a = adminClient();
  await a.from('subscriptions').update({ status: 'trialing', created_at: new Date().toISOString(), trial_ends_at: null }).eq('venue_id', TRIAL_VENUE);
  await a.from('subscriptions').update({ status: 'trialing', created_at: new Date().toISOString(), trial_ends_at: null }).eq('venue_id', VESPER);
});

test.afterAll(async () => {
  await adminClient().from('subscriptions').update({ status: 'comped', trial_ends_at: null }).eq('venue_id', VESPER);
});

async function signIn(page: Page, context: BrowserContext, baseURL: string | undefined, email: string, venue: string, next: string): Promise<void> {
  await context.clearCookies();
  const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
  await context.addCookies([{ name: 'po_active_venue', value: venue, domain: host, path: '/' }]);
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}&next=${next}`);
  await page.waitForURL(new RegExp(next.replace(/\//g, '\\/')));
}

const setupPayment = (page: Page) => page.getByRole('button', { name: /Set up payment/i });

test('billing: More → Billing, browser vs native, admin / finance / manager', async ({ page, context, flow, baseURL }) => {
  await signIn(page, context, baseURL, 'admin@plusone.test', TRIAL_VENUE, '/app/more');
  await expect(page.getByText('De Marktzaal').first()).toBeVisible();

  await flow.check(1, 'The app seam reports native exactly in the native variants', async () => {
    expect(await reportsNative(page)).toBe(flow.native);
  });
  await flow.check(2, 'More → Billing row reads "Pro · Trial ends in N days" (no price, both surfaces)', async () => {
    await expect(page.getByText(/^Pro · Trial ends in \d+ days$/).first()).toBeVisible();
    await expect(page.getByText(/Pro · €/)).toHaveCount(0);
  });
  await flow.shot('more-admin');

  await page.getByText(/^Billing$/).first().click();
  await page.waitForURL(/\/app\/billing/);
  await expect(page.getByText('TRIAL').first()).toBeVisible();

  await flow.check(3, 'Billing card: plan "Pro", status TRIAL, "Trial ends in N days"', async () => {
    await expect(page.getByText('Pro', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/Trial ends in \d+ days/).first()).toBeVisible();
  });

  if (flow.native) {
    await flow.check(4, 'Native: status only — "Subscription changes aren\'t available in the app.", no interval, no button, no link, no purchase copy', async () => {
      await expect(page.getByText("Subscription changes aren't available in the app.")).toBeVisible();
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expect(page.getByRole('button', { name: /payment|manage|checkout|portal|reactivate|upgrade/i })).toHaveCount(0);
      await expect(page.locator('a[href^="http"]:not([href*="localhost"])')).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    });
    flow.skip(5, 'Browser: Monthly / Yearly, each "Price shown at checkout" (stub), and "Set up payment"');
    flow.skip(6, 'Browser: Yearly → Set up payment reaches the checkout action (stub answers "Billing isn\'t live yet")');
    await flow.shot('billing-admin-native');
  } else {
    flow.skip(4, 'Native: status only — no interval, no button, no link, no purchase copy');
    await flow.check(5, 'Browser: Monthly / Yearly, each "Price shown at checkout" (stub), and "Set up payment"', async () => {
      await expect(page.getByRole('radio', { name: /Monthly/ })).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByRole('radio', { name: /Yearly/ })).toBeVisible();
      await expect(page.getByText('Price shown at checkout')).toHaveCount(2);
      await expect(setupPayment(page)).toBeVisible();
      await expect(page.getByText('Card, SEPA Direct Debit or iDEAL').first()).toBeVisible();
    });
    await flow.shot('billing-admin-browser');
    await flow.check(6, 'Browser: Yearly → Set up payment reaches the checkout action (stub answers "Billing isn\'t live yet")', async () => {
      await page.getByRole('radio', { name: /Yearly/ }).click();
      await expect(page.getByRole('radio', { name: /Yearly/ })).toHaveAttribute('aria-checked', 'true');
      await setupPayment(page).click();
      await expect(page.getByText(/Billing isn't live yet/).first()).toBeVisible();
    });
    await flow.shot('billing-admin-yearly-stub');
  }

  // finance@ — billing rights since Billing G.
  await signIn(page, context, baseURL, 'finance@plusone.test', VESPER, '/app/billing');
  await expect(page.getByText('TRIAL').first()).toBeVisible();
  await flow.check(7, 'finance@: browser offers "Set up payment"; native shows no button', async () => {
    if (flow.native) await expect(page.getByRole('button', { name: /payment/i })).toHaveCount(0);
    else await expect(setupPayment(page)).toBeVisible();
  });
  await flow.shot('billing-finance');

  // manager@ — sees the plan and status, never the purchase controls.
  await signIn(page, context, baseURL, 'manager@plusone.test', VESPER, '/app/billing');
  await expect(page.getByText('TRIAL').first()).toBeVisible();
  await flow.check(8, 'manager@: status only, no "Set up payment" and no interval picker', async () => {
    await expect(setupPayment(page)).toHaveCount(0);
    await expect(page.getByRole('radio')).toHaveCount(0);
  });
  await flow.shot('billing-manager');

  await flow.check(9, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(10, 'No link opens a new browser window (target=_blank)', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  });
  await flow.check(11, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});
