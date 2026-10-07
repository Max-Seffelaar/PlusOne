import { test, expect, type Page } from '@playwright/test';
import { acceptConsent, adminClient, getUserIdByEmail } from './helpers/supabase-admin';

/**
 * Native-shell guard (Billing G, store-tax seam #32/#37, Apple 3.1.1/3.1.3(f),
 * Play payments policy) — the running app, in e2e:smoke. Every page here runs
 * with the same globals the Capacitor shell injects before any page script
 * (`window.androidBridge` + a native `Capacitor`), so `isNativeShell()` is true
 * from the first render. Inside the shell:
 *   - /onboarding is Welcome → Company → Team: no plan step, no payment step,
 *     no price and no purchase button at any point of the walk;
 *   - /app (Home, incl. a lapsed trial's lock note) and /app/billing show no
 *     "€", no "Set up payment", no "Manage …", no outbound URL and no link;
 *   - More → Switch company → New company shows no billing, payment or
 *     "comped" copy (orchestrator review on PR #422).
 * The unit guards (billing.native.test.tsx, native-store-tax.test.tsx) pin the
 * components; the QA-0 flows (native-shell-guard.flow.ts, billing-g.flow.ts)
 * screenshot it. This spec is the CI-required behavioural gate.
 *
 * Seed: admin@ is the only member of De Marktzaal (…0002, trialing — Club
 * Vesper is comped and would hide the trial paths), selected through the
 * active-venue cookie. Plain seed: admin@ has no MFA factor there and MFA is
 * optional, so dev-login lands straight in the app.
 */

const ADMIN = 'admin@plusone.test';
const TRIAL_VENUE = 'aa000000-0000-7000-8000-000000000002';

/** Anything a store reviewer would read as a price or a purchase call to action. */
const PURCHASE_COPY = /€|\/ ?month|\/ ?year|set up payment|\bmanage\b|payment|checkout|portal|reactivate|upgrade|pick (a|your) plan|\biDEAL\b|\bSEPA\b|on the web/i;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.androidBridge = { postMessage: () => {} };
    w.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android' };
  });
});

/** No price and no purchase call to action — text or button. */
async function expectNoPurchaseCopy(page: Page): Promise<void> {
  await expect(page.locator('body')).not.toHaveText(PURCHASE_COPY);
  await expect(page.getByRole('button', { name: /payment|\bmanage\b|checkout|portal|reactivate|upgrade|copy/i })).toHaveCount(0);
}

/** The app screens: purchase copy AND any way out of the app. (The onboarding
 *  company step keeps its Terms/Privacy links — the consent's legal
 *  requirement, not a purchase pointer — so /onboarding checks copy only.) */
async function expectNoPurchaseSurface(page: Page): Promise<void> {
  await expectNoPurchaseCopy(page);
  // No outbound URL: no external href, no target=_blank, and no URL in the text.
  await expect(page.locator('a[href^="http"]:not([href*="localhost"]):not([href*="127.0.0.1"])')).toHaveCount(0);
  await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveText(/https?:\/\/(?!localhost|127\.0\.0\.1)/);
}

async function reportsNative(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    return Boolean(cap?.isNativePlatform?.());
  });
}

test.describe('native shell: no purchase surface (Billing G)', () => {
  test('/onboarding: Welcome → Company → Team, no plan or payment step', async ({ page }) => {
    const email = `e2e-native-onb-${Date.now().toString(36)}@plusone.test`;
    await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}&create=1&next=/onboarding`);
    await page.waitForURL(/\/(consent|onboarding)/, { timeout: 60_000 });
    expect(await reportsNative(page)).toBe(true);

    if (/\/consent/.test(page.url())) {
      const first = page.getByPlaceholder('First name');
      if (await first.count()) {
        await first.fill('Native');
        await page.getByPlaceholder('Last name').fill('Owner');
      }
      await page.locator('input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: /Create account|Agree/i }).first().click();
      await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    }

    // Welcome: two steps, none about a plan.
    await expect(page.getByRole('button', { name: /Set up account/i })).toBeVisible();
    await expect(page.getByText(/Two quick/)).toBeVisible();
    await expectNoPurchaseCopy(page);
    await page.getByRole('button', { name: /Set up account/i }).click();

    // Company.
    await page.getByPlaceholder('e.g. LOFI').fill('Club Native');
    const club = page.getByRole('button', { name: /^Club$/ });
    if (await club.count()) await club.first().click();
    const consent = page.locator('input[type="checkbox"]');
    if (await consent.count()) await consent.first().check();
    await expectNoPurchaseCopy(page);
    await page.getByRole('button', { name: 'Create company' }).click();

    // Straight to Team: no plan / payment / trial-start step in between.
    await expect(page.getByRole('button', { name: /Skip for now/i }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Pick your plan|Set up your payment|Getting your company ready/i)).toHaveCount(0);
    await expectNoPurchaseCopy(page);
  });

  test.describe('signed-in admin on a trialing company', () => {
    test.beforeAll(async () => {
      await acceptConsent(ADMIN);
      const id = await getUserIdByEmail(ADMIN);
      const { error } = await adminClient().from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', id ?? '');
      if (error) throw new Error(`native-shell guard setup: ${error.message}`);
    });

    test.beforeEach(async ({ context, baseURL }) => {
      const host = new URL(baseURL ?? 'http://localhost:3000').hostname;
      await context.addCookies([{ name: 'po_active_venue', value: TRIAL_VENUE, domain: host, path: '/' }]);
    });

    test('/app/billing: plan + status only, no price, button or link', async ({ page }) => {
      await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/billing`);
      await page.waitForURL(/\/app\/billing/, { timeout: 60_000 });
      expect(await reportsNative(page)).toBe(true);
      await expect(page.getByText('TRIAL').first()).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Pro').first()).toBeVisible();
      await expect(page.getByText(/Trial ends in \d+ days\./).first()).toBeVisible();
      await expect(page.getByText("Subscription changes aren't available in the app.")).toBeVisible();
      await expect(page.getByRole('radio')).toHaveCount(0);
      await expectNoPurchaseSurface(page);
    });

    test('/app: Home and More carry no purchase surface', async ({ page, baseURL }) => {
      await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app`);
      await page.waitForURL(/\/app/, { timeout: 60_000 });
      await expect(page.getByText('De Marktzaal').first()).toBeVisible({ timeout: 30_000 });
      await expectNoPurchaseSurface(page);

      await page.goto(new URL('/app/more', baseURL).toString());
      await expect(page.getByText(/Pro · Trial ends in \d+ days/).first()).toBeVisible({ timeout: 30_000 });
      await expectNoPurchaseSurface(page);
    });

    test('More → Switch company → New company: no billing or payment copy', async ({ page, baseURL }) => {
      await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app/venue/switch`);
      await page.waitForURL(/\/app\/venue\/switch/, { timeout: 60_000 });
      expect(await reportsNative(page)).toBe(true);
      await page.getByText('Add a new company').first().click();
      await page.waitForURL(new RegExp(`${new URL('/app/venue/new', baseURL).pathname}$`), { timeout: 30_000 });
      await expect(page.getByRole('button', { name: 'Create company' })).toBeVisible({ timeout: 30_000 });
      // The consent's Terms/Privacy links stay (legal requirement), so this is
      // the copy check plus the pilot vocabulary, not the link check.
      await expectNoPurchaseCopy(page);
      await expect(page.locator('body')).not.toHaveText(/comped|subscription/i);
    });

    test('/app with a lapsed trial: the lock note states the lock, no button', async ({ page }) => {
      // Lapse De Marktzaal's trial (service-role test setup; restored after).
      const a = adminClient();
      const lapsed = new Date(Date.now() - 20 * 86_400_000).toISOString();
      const { data: before } = await a
        .from('subscriptions')
        .select('created_at, trial_ends_at')
        .eq('venue_id', TRIAL_VENUE)
        .single();
      await a.from('subscriptions').update({ created_at: lapsed, trial_ends_at: null }).eq('venue_id', TRIAL_VENUE);
      try {
        await page.goto(`/auth/dev-login?email=${encodeURIComponent(ADMIN)}&next=/app`);
        await page.waitForURL(/\/app/, { timeout: 60_000 });
        await expect(
          page.getByText('Your trial has ended. New events and team invites are paused.', { exact: false }).first()
        ).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole('button', { name: /Go to Billing/i })).toHaveCount(0);
        await expectNoPurchaseSurface(page);
      } finally {
        if (before) {
          await a
            .from('subscriptions')
            .update({ created_at: before.created_at, trial_ends_at: before.trial_ends_at })
            .eq('venue_id', TRIAL_VENUE);
        }
      }
    });
  });
});
