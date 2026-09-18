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
 *   · query-string navigation — the door's `?event=` (pushed explicitly from
 *     the event's "Check-in" button), the guest overlay's `?guest=` (raw
 *     History, the door's offline invariant #25), and the popstate back out of
 *     it, which IS a router-level query-only navigation.
 *
 * HERMETIC BY CONSTRUCTION (review of #287). The measurement deliberately does
 * NOT enter the door through the bottom tab: a bare `/app/door` resolves its
 * event from the door's IMPLICIT single-candidate pin, which only fires when
 * the venue has exactly one open candidate — i.e. only on a freshly reset DB.
 * `core-flow.spec.ts` leaves extra open events behind, so on any second run
 * against the same database the picker rendered instead of the check-in list
 * and this spec failed on a missing search box, reading as a broken door
 * rather than as a dirty database. Both specs now live in `pnpm e2e:smoke`
 * side by side, so that could not stay a matter of file ordering. Entering via
 * `openDoor` (→ `/app/door?event=<id>`, the same URL `door-overlay-back.spec.ts`
 * uses) is independent of how many other events exist, and still exercises the
 * `?event=` query-string leg. The implicit pin keeps its own test below.
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

/** Clear everything that would bounce the doorhost off `/app` (consent gate,
 *  MFA enroll nudge) so a login lands straight on the shell. */
async function prepareDoorhost(): Promise<void> {
  const db = adminClient();
  await acceptConsent(DOOR_EMAIL);
  await db.from('user_profiles').update({ mfa_snooze_until: 'infinity' }).eq('id', DOOR_ID);
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
  await prepareDoorhost();

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

  // ── Screen navigation: tab → tab → pushed detail screen. ──
  await tab(page, 'Guests').click();
  await page.waitForURL('**/app/guests', { timeout: 30_000 });
  await expectNoRemount('tab switch to Guests');

  await tab(page, 'Events').click();
  await page.waitForURL('**/app/events', { timeout: 30_000 });
  await expectNoRemount('tab switch to Events');

  await page.getByText(EVENT_A_NAME).first().click();
  await page.waitForURL(/\/app\/events\/[0-9a-f-]+$/, { timeout: 30_000 });
  const eventDetailUrl = page.url();
  await expectNoRemount('push to the event detail screen');

  // ── Query-string navigation: the event's own "Check-in" button is
  //    `nav.openDoor(id)` → `router.push('/app/door?event=<id>')`, a navigation
  //    whose target differs from a bare door tab ONLY by the query string. No
  //    dependency on the candidate count (see the header note). `.first()`:
  //    since item L renamed the door tab from "Door" to "Check-in", the mobile
  //    bottom tab now ALSO reads "Check-in" — the event detail's own CTA
  //    button (the one we want) renders before the tab bar in the DOM. ──
  await page.getByRole('button', { name: 'Check-in', exact: true }).first().click();
  await expect(page).toHaveURL(new RegExp(`/app/door\\?event=${EVENT_A}`), { timeout: 30_000 });
  const searchBox = page.getByPlaceholder('Search a name…');
  await expect(searchBox).toBeVisible({ timeout: 60_000 });
  await expectNoRemount('opening the door for one event (?event=, query-string change)');

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

  // ── Browser Back out of the door, all the way back to the pushed screen it
  //    was opened from. The overlay pushed and popped one entry of its own, so
  //    this must land on the event detail, not somewhere inside the door. ──
  await page.goBack();
  await page.waitForURL(eventDetailUrl, { timeout: 30_000 });
  await expectNoRemount('browser Back out of the door onto the event detail screen');

  // Final statement of the acceptance criterion, in one line.
  expect(await shellMounts(page), 'total /app shell mounts across the whole flow').toBe(baseline);
});

/**
 * The implicit single-candidate pin (`doorCandidates.length === 1` in
 * `app.tsx`), kept as its own assertion now that the measurement above no
 * longer leans on it. It cannot assert the pin unconditionally — it is only
 * the correct behaviour while the venue really has one open candidate, and
 * this suite deliberately shares one database (`workers: 1`, CLAUDE.md's "One
 * DB owner"), so `core-flow.spec.ts` legitimately leaves a second open event
 * behind. The two branches are both real behaviour, and the picker branch is
 * not a free pass: a picker offering a SINGLE card would mean the implicit pin
 * stopped firing, which is what fails the assertion there.
 */
test('the door tab resolves its event on its own: pins the only candidate, otherwise offers the picker', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await prepareDoorhost();

  await page.goto(`/auth/dev-login?email=${DOOR_EMAIL}&next=/app`);
  await page.waitForURL('**/app', { timeout: 90_000 });

  await tab(page, 'Check-in').click();
  await page.waitForURL(/\/app\/door/, { timeout: 30_000 });

  const pickerTitle = page.getByRole('heading', { name: 'Pick an event' });
  const searchBox = page.getByPlaceholder('Search a name…');
  // Whichever way it resolves, the door must settle on one of the two — never
  // an empty screen.
  await expect(pickerTitle.or(searchBox).first()).toBeVisible({ timeout: 60_000 });

  if (await pickerTitle.isVisible()) {
    // Used database: more than one open candidate, so not picking is right.
    expect(
      await page.locator('.evcard').count(),
      'the picker rendered for a single candidate — the implicit single-candidate pin stopped firing',
    ).toBeGreaterThan(1);
  } else {
    // Fresh database (one seeded open event): the pin fires and lands the
    // doorhost straight on the check-in list, with the choice in the URL.
    await expect(page).toHaveURL(new RegExp(`/app/door\\?event=${EVENT_A}`), { timeout: 30_000 });
  }
});
