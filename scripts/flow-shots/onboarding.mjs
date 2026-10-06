// Flow screenshots: walk the new-owner onboarding as a brand-new account and screenshot every
// step, in four variants — desktop browser, phone browser, phone inside the native shell and
// iPad inside the native shell. The native shell is simulated the way @capacitor/core detects
// it (the `androidBridge` global), not by faking `window.Capacitor`, which core overwrites.
//
// Local only: it uses /auth/dev-login?create=1 against the LOCAL stack (the route 404s in prod).
//
//   pnpm dev                      # or any dev server; pass BASE=http://localhost:70xx
//   node scripts/flow-shots/onboarding.mjs
//   ONLY=phone-native node scripts/flow-shots/onboarding.mjs
//
// Output: flow-screenshots/onboarding/<variant>/NN-step.png (gitignored). Seed of the QA-0
// harness in onboarding-orchestration-claude-code.md; each task adds its own flow next to it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:7000';
const OUT = process.env.OUT ?? join(process.cwd(), 'flow-screenshots', 'onboarding');
const stamp = Date.now().toString(36);
const T = 90_000;

const VARIANTS = [
  { name: 'desktop-browser', viewport: { width: 1280, height: 800 }, mobile: false, native: false },
  { name: 'phone-browser', viewport: { width: 390, height: 844 }, mobile: true, native: false },
  { name: 'phone-native', viewport: { width: 390, height: 844 }, mobile: true, native: true },
  { name: 'ipad-native', viewport: { width: 1024, height: 768 }, mobile: true, native: true },
];

async function shot(page, dir, n, label) {
  await page.waitForTimeout(600);
  const file = join(dir, `${String(n).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log('  shot', file);
}

async function agree(page) {
  const native = page.locator('input[type="checkbox"]');
  if (await native.count()) {
    await native.first().check();
    return;
  }
  const txt = page.getByText(/I agree to the/i);
  if (await txt.count()) {
    await txt.first().click();
    return;
  }
  throw new Error('no consent control found');
}

async function clickButton(page, re) {
  const b = page.getByRole('button', { name: re }).first();
  await b.waitFor({ state: 'visible', timeout: T });
  await b.click();
}

async function run(v) {
  const dir = join(OUT, v.name);
  mkdirSync(dir, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: v.viewport,
    isMobile: v.mobile,
    hasTouch: v.mobile,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  if (v.native) {
    await ctx.addInitScript(() => {
      window.androidBridge = { postMessage: () => {} };
    });
  }
  const page = await ctx.newPage();
  page.setDefaultTimeout(T);
  const email = `onb-${v.name}-${stamp}@plusone.test`;
  console.log(`== ${v.name} as ${email}`);
  let n = 1;

  await page.goto(`${BASE}/auth/dev-login?email=${encodeURIComponent(email)}&create=1&next=/onboarding`, {
    waitUntil: 'networkidle',
    timeout: T,
  });
  await page.waitForURL(/\/(consent|onboarding)/, { timeout: T });
  await page.waitForLoadState('networkidle');

  if (/\/consent/.test(page.url())) {
    await page.getByText(/agree/i).first().waitFor({ timeout: T });
    await shot(page, dir, n++, 'account-consent');
    const first = page.getByPlaceholder('First name');
    if (await first.count()) {
      await first.fill('Joeri');
      await page.getByPlaceholder('Last name').fill('Tester');
    }
    await agree(page);
    await shot(page, dir, n++, 'account-consent-filled');
    await clickButton(page, /Create account|Agree/i);
    await page.waitForURL(/\/onboarding/, { timeout: T });
    await page.waitForLoadState('networkidle');
  }

  await page.getByRole('button', { name: /Set up account/i }).waitFor({ timeout: T });
  await shot(page, dir, n++, 'welcome');
  await clickButton(page, /Set up account/i);

  await page.getByPlaceholder('e.g. LOFI').waitFor({ timeout: T });
  await shot(page, dir, n++, 'company-empty');
  await page.getByPlaceholder('e.g. LOFI').fill('Club Nova');
  await page.getByPlaceholder('Wibautstraat 150, Amsterdam').fill('Wibautstraat 150, Amsterdam');
  const club = page.getByRole('button', { name: /^Club$/ });
  if (await club.count()) await club.first().click();
  await agree(page);
  await shot(page, dir, n++, 'company-filled');
  await clickButton(page, /Create venue|Create company/i);

  const planHeading = page.getByText(/Pick your plan/i);
  const teamButton = page.getByRole('button', { name: /Skip for now/i });
  const trialHeading = page.getByText(/Getting your (venue|company) ready/i);
  await Promise.race([
    planHeading.first().waitFor({ timeout: T }),
    teamButton.first().waitFor({ timeout: T }),
    trialHeading.first().waitFor({ timeout: T }),
  ]);
  if (await trialHeading.count()) await shot(page, dir, n++, 'trial-start-native');
  if (await planHeading.count()) {
    await shot(page, dir, n++, 'plan');
    await clickButton(page, /Continue to payment/i);
    await page.getByText(/Set up your payment/i).first().waitFor({ timeout: T });
    await shot(page, dir, n++, 'payment');
    await clickButton(page, /^Continue$/i);
  }

  await teamButton.first().waitFor({ timeout: T });
  await shot(page, dir, n++, 'team');
  await clickButton(page, /Skip for now/i);
  await page.waitForURL(/\/app/, { timeout: T });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
  await shot(page, dir, n++, 'app-home');

  const more = page
    .getByRole('link', { name: /^More$/ })
    .or(page.getByRole('button', { name: /^More$/ }))
    .or(page.getByText(/^More$/));
  await more.first().click();
  await page.waitForTimeout(1200);
  await shot(page, dir, n++, 'more');
  const billing = page.getByText(/^Billing$/).first();
  if (await billing.count()) {
    await billing.click();
    await page.waitForTimeout(1500);
    await shot(page, dir, n++, 'billing');
  } else {
    console.log('  no Billing row visible');
  }

  await browser.close();
}

const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
for (const v of VARIANTS) {
  if (only && !only.includes(v.name)) continue;
  try {
    await run(v);
  } catch (e) {
    console.error(`!! ${v.name} failed:`, e.message);
    process.exitCode = 1;
  }
}
console.log('done');
