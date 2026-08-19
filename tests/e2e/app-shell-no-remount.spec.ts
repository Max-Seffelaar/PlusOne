import { test, expect, type Page } from '@playwright/test';
import { v7 as uuidv7 } from 'uuid';
import { acceptConsent, adminClient } from './helpers/supabase-admin';

/**
 * The `/app` shell must MOUNT ONCE per page load (86ey9uc87).
 *
 * `PlusOneApp` used to remount in full on every `router.push`, because it was
 * rendered by `[[...segments]]/page.tsx`: Next rebuilds the page subtree for
 * each segment path, so the whole shell was torn down and recreated on every
 * screen change. Every shell effect re-ran per navigation (billing return,
 * identity, viewport, nav construction, entrance animation) and every piece of
 * shell state reset — which is exactly why `hasPushedThisSession` had to be a
 * module variable to survive at all.
 *
 * The fix mounts the shell from `app/layout.tsx`, which Next keeps mounted
 * across client-side navigation to sibling pages. `tests/unit/
 * app-shell-no-ssr-suspense.test.ts` pins that structure; this spec MEASURES
 * the result, because "the mount point moved" and "it actually stops
 * remounting" are different claims and only the second one is the acceptance
 * criterion.
 *
 * The probe is `window.__poShellMounts`, incremented by a mount effect in
 * `app.tsx` (dev/test builds only). We assert against the count taken right
 * after first paint rather than a hard-coded 1: `reactStrictMode` is on, so in
 * dev React deliberately double-invokes mount effects, making the honest
 * baseline 2. What matters is that the number never moves again — a remount
 * would push it past the baseline on the very first navigation.
 *
 * Covers both navigation shapes the task calls out:
 *   · screen navigation — tab switches, a pushed detail screen, browser Back;
 *   · query-string navigation — the door's `?event=`, the guest overlay's
 *     `?guest=` (raw History, the door's offline invariant #25), and the
 *     popstate back out of it, which IS a router-level query-only navigation.
 *
 * door@ = Lisa (doorhost + staff at Club Vesper): needs no MFA and is the one
 * seed user who sees both the ordinary tabs and the Deur tab.
 */

const DOOR_EMAIL = 'door@plusone.test';
const DOOR_ID = '66666666-6666-4666-8666-666666666666';
const EVENT_A = 'ee000000-0000-7000-8000-000000000001'; // seed "PLUSONE Launch Night"
const EVENT_A_NAME = 'PLUSONE Launch Night';
const REGULAR_TIER = 'dd000000-0000-7000-8000-000000000001';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'; // quota-exempt adder

test.use({ viewport: { width: 390, height: 844 } });

async function shellMounts(page: Page): Promise<number> {
  return page.evaluate(() => (window as Window & { __poShellMounts?: number }).__poShellMounts ?? 0);
}

/**
 * Next's dev-tools indicator is a fixed badge in the bottom-LEFT corner, which
 * sits exactly on top of the first bottom-tab ("Home") and swallows its clicks.
 * Every other tab is clear of it, so this spec simply never navigates via the
 * leftmost tab — `page.goBack()` covers the return trip instead. Nothing to do
 * with the app: the badge only exists because e2e runs against `pnpm dev`.
 */
function tab(page: Page, name: string) {
  // `.last()`: the bottom tab bar renders after any same-named content button.
  return page.getByRole('button', { name, exact: true }).last();
}

test('the /app shell mounts once and survives screen + query-string navigation', async ({ page }) => {
  test.setTimeout(180_000); // the dev server compiles /app and /app/door on first hit
  const db = adminClient();
  await acceptConsent(DOOR_EMAIL);
  await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', DOOR_ID);

  // A known guest so the door's guest overlay can be opened by name (the
  // check-in list is virtualized, so search first).
  const guestName = `Remounttest ${Date.now().toString(36)}`;
  {
    const { error } = await db.from('guests').insert({
      id: uuidv7(),
      event_id: EVENT_A,
      tier_id: REGULAR_TIER,
      full_name: guestName,
      added_by: ADMIN_ID,
      source: 'app',
      status: 'approved',
    });
    if (error) throw new Error(`seed guest failed: ${error.message}`);
  }

  // ── Land on /app and take the baseline once the board has really rendered. ──
  await page.goto(`/auth/dev-login?email=${DOOR_EMAIL}&next=/app`);
  await page.waitForURL('**/app', { timeout: 90_000 });
  await expect(page.getByText(EVENT_A_NAME).first()).toBeVisible({ timeout: 60_000 });

  const baseline = await shellMounts(page);
  expect(baseline, 'the mount probe never fired — is the dev-only probe in app.tsx still there?').toBeGreaterThan(0);
  // 1 in a plain build, 2 under reactStrictMode's dev double-invoke. More than
  // that would already mean the shell remounted during the initial load.
  expect(baseline, 'the shell mounted more than once before any navigation').toBeLessThanOrEqual(2);

  const expectNoRemount = async (step: string): Promise<void> => {
    expect(await shellMounts(page), `PlusOneApp remounted on: ${step}`).toBe(baseline);
  };

  // ── Screen navigation: tab → pushed detail screen → browser Back → tab. ──
  await tab(page, 'Events').click();
  await page.waitForURL('**/app/events', { timeout: 30_000 });
  await expectNoRemount('tab switch to Events');

  await page.getByText(EVENT_A_NAME).first().click();
  await page.waitForURL(/\/app\/events\/[0-9a-f-]+$/, { timeout: 30_000 });
  await expectNoRemount('push to the event detail screen');

  await page.goBack();
  await page.waitForURL('**/app/events', { timeout: 30_000 });
  await expectNoRemount('browser Back out of the event detail screen');

  await tab(page, 'Guests').click();
  await page.waitForURL('**/app/guests', { timeout: 30_000 });
  await expectNoRemount('tab switch to Guests');

  // ── Query-string navigation: the door pins `?event=` on its own (one
  //    candidate in the seed), then the guest overlay adds `?guest=`. ──
  await tab(page, 'Door').click();
  await page.waitForURL(/\/app\/door/, { timeout: 30_000 });
  const searchBox = page.getByPlaceholder('Search a name…');
  await expect(searchBox).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`/app/door\\?event=${EVENT_A}`), { timeout: 30_000 });
  await expectNoRemount('door tab pinning ?event= (query-string change)');

  await searchBox.fill(guestName);
  await page.getByRole('button', { name: new RegExp(guestName) }).click();
  const backBtn = page.getByRole('button', { name: 'Back', exact: true });
  await expect(backBtn).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/[?&]guest=/);
  await expectNoRemount('opening the door guest overlay (?guest=)');

  // The overlay's Back is `router.back()` → popstate → a Next navigation whose
  // ONLY difference is the query string. This is the query-only router
  // navigation the task asks about, and the one door hosts hit constantly.
  await backBtn.click();
  await expect(searchBox).toBeVisible({ timeout: 20_000 });
  await expect(page).not.toHaveURL(/[?&]guest=/);
  await expectNoRemount('closing the door guest overlay via Back (popstate, query-only)');

  // Final statement of the acceptance criterion, in one line.
  expect(await shellMounts(page), 'total /app shell mounts across the whole flow').toBe(baseline);
});
