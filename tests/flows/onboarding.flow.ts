import { test, expect, expectNoHorizontalOverflow, reportsNative, PURCHASE_COPY, type Flow } from './harness';
import type { Page } from '@playwright/test';

/**
 * Flow: a brand-new owner from first login to the Billing screen, in all four
 * variants (desktop browser, phone browser, phone + iPad inside the native
 * shell). Each run mints a fresh account with `/auth/dev-login?create=1` (local
 * stack only — the route 404s in prod), so it never depends on seed state and
 * can run again on the same stack.
 *
 * The numbered checks are the machine-answerable half of this flow's test
 * handoff (CLAUDE.md "Per-screen test handoff"); the rest of the handoff is
 * 👁 (look at screenshot NN on the contact sheet) or 🖐 (hands on a device).
 */

const VENUE = 'Club Nova';

async function wizardHasNoPurchaseCopy(page: Page, flow: Flow): Promise<void> {
  if (!flow.native) return;
  await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
}

test('onboarding: new owner, consent → wizard → app → billing', async ({ page, flow, baseURL }) => {
  const email = `flow-onb-${flow.variant}-${Date.now().toString(36)}@plusone.test`;

  await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}&create=1&next=/onboarding`);
  await page.waitForURL(/\/(consent|onboarding)/);

  await flow.check(1, 'A fresh account sees the account consent (Terms + Privacy) first', async () => {
    await expect(page).toHaveURL(/\/consent/);
    await expect(page.getByText(/I agree to the/i).first()).toBeVisible();
  });
  if (flow.native) {
    await flow.check(13, 'The native-shell simulation is live (the app seam reports native)', async () => {
      expect(await reportsNative(page)).toBe(true);
    });
  } else {
    flow.skip(13, 'The native-shell simulation is live (the app seam reports native)');
  }
  await flow.shot('account-consent');

  const submit = page.getByRole('button', { name: /Create account|Agree/i }).first();
  await flow.check(2, '"Create account" stays disabled until the consent box is ticked', async () => {
    const first = page.getByPlaceholder('First name');
    if (await first.count()) {
      await first.fill('Joeri');
      await page.getByPlaceholder('Last name').fill('Tester');
    }
    await expect(submit).toBeDisabled();
    await agree(page);
    await expect(submit).toBeEnabled();
  });
  await flow.shot('account-consent-filled');
  await submit.click();

  await flow.check(3, 'After consent the wizard opens on Welcome', async () => {
    await page.waitForURL(/\/onboarding/);
    await expect(page.getByRole('button', { name: /Set up account/i })).toBeVisible();
    await wizardHasNoPurchaseCopy(page, flow);
  });
  await flow.shot('welcome');
  await page.getByRole('button', { name: /Set up account/i }).click();

  const name = page.getByPlaceholder('e.g. LOFI');
  await expect(name).toBeVisible();
  await flow.shot('company-empty');
  await name.fill(VENUE);
  await page.getByPlaceholder('Wibautstraat 150, Amsterdam').fill('Wibautstraat 150, Amsterdam');
  const club = page.getByRole('button', { name: /^Club$/ });
  if (await club.count()) await club.first().click();
  await agree(page);
  await flow.shot('company-filled');
  await page.getByRole('button', { name: /Create venue|Create company/i }).first().click();

  const planHeading = page.getByText(/Pick your plan/i).first();
  const skipTeam = page.getByRole('button', { name: /Skip for now/i }).first();
  const trialStart = page.getByText(/Getting your (venue|company) ready/i).first();

  await flow.check(4, 'Company step creates the venue and moves on', async () => {
    await expect(planHeading.or(skipTeam).or(trialStart)).toBeVisible();
  });

  await flow.check(5, 'Plan + payment steps: offered in the browser; absent in the native shell (trial starts silently, no purchase copy)', async () => {
    if (flow.native) {
      await expect(planHeading).toBeHidden();
      if (await trialStart.isVisible()) await flow.shot('trial-start-native');
      await expect(skipTeam).toBeVisible();
      await wizardHasNoPurchaseCopy(page, flow);
    } else {
      await expect(planHeading).toBeVisible();
      await flow.shot('plan');
      await page.getByRole('button', { name: /Continue to payment/i }).click();
      await expect(page.getByText(/Set up your payment/i).first()).toBeVisible();
      await flow.shot('payment');
      await page.getByRole('button', { name: /^Continue$/i }).click();
    }
  });

  await expect(skipTeam).toBeVisible();
  await flow.shot('team');
  await flow.check(6, 'The Team step can be skipped and lands in the app', async () => {
    await skipTeam.click();
    await page.waitForURL(/\/app/);
    await expect(page.getByText(VENUE).first()).toBeVisible();
  });
  await flow.shot('app-home');

  await flow.check(7, 'Onboarding stays done after a reload (no bounce back to the wizard)', async () => {
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page).toHaveURL(/\/app/);
  });

  await flow.check(8, `The new venue ("${VENUE}") is the active one in the app`, async () => {
    await page.goto(new URL('/app/more', baseURL).toString());
    await expect(page.getByText(VENUE).first()).toBeVisible();
  });
  await flow.shot('more');

  await flow.check(9, 'Billing shows TRIAL; browser offers "Set up payment", native shows only status + "Subscription changes aren\'t available in the app."', async () => {
    await page.getByText(/^Billing$/).first().click();
    await expect(page.getByText('TRIAL').first()).toBeVisible();
    if (flow.native) {
      await expect(page.getByText("Subscription changes aren't available in the app.")).toBeVisible();
      await expect(page.getByRole('button', { name: /payment|checkout|portal|reactivate|upgrade/i })).toHaveCount(0);
      await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
    } else {
      await expect(page.getByRole('button', { name: /Set up payment/i })).toBeVisible();
      await expect(page.getByText('SEPA Direct Debit & iDEAL').first()).toBeVisible();
    }
  });
  await flow.shot('billing');

  await flow.check(10, 'No step scrolls sideways', async () => {
    expectNoHorizontalOverflow(flow);
  });
  await flow.check(11, 'No link opens a new browser window (target=_blank) on the screens walked', async () => {
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  });
  await flow.check(12, 'No uncaught page errors during the whole walk', async () => {
    expect(flow.pageErrors).toEqual([]);
  });
});

async function agree(page: Page): Promise<void> {
  const box = page.locator('input[type="checkbox"]');
  if (await box.count()) {
    await box.first().check();
    return;
  }
  await page.getByText(/I agree to the/i).first().click();
}
