import { test, expect, type Page } from '@playwright/test';
import { CHROME_BREAKPOINT, deviceFor } from './matrix';
import { SEED } from './screens';
import { newProjectContext, openScreen } from './probe';
import { doorPath } from '@/components/po/routes';

/**
 * Which Deur variant each device gets — plan decision 14 (design-system.md
 * "Breakpoints & tablet", decided 2026-09-24): `(pointer: coarse)` OR <1024px
 * gets the door WITH the offline outbox (`DoorProvider`, #25); only a fine
 * pointer at ≥1024px gets the online-only Event-day cockpit.
 *
 * Markers, both tied to the variant rather than to shared copy (both variants
 * carry a "Check-in" page title, so a heading proves nothing):
 *   outbox door — the check-in list's search ("Search a name…") AND the
 *                 door's IndexedDB store (`plusone-door`, opened by the
 *                 DoorProvider's offline layer, never by the cockpit);
 *   cockpit     — its own search (quick check-in / "Search a guest…"), with
 *                 no door-list search and no door store opened.
 *
 * Opened on the seed event (`?event=`) so the result never depends on how many
 * open events the database holds (see app-shell-no-remount.spec.ts).
 */

const DOOR_URL = doorPath({ eventId: SEED.eventId });
const DOOR_SEARCH = 'Search a name…';
// The cockpit's search: `t.cockpit.searchCheckIn` for a doorhost, else
// `t.cockpit.searchPlaceholder` (src/lib/i18n/surfaces/cockpit.ts).
const COCKPIT_SEARCH = /^(Quick check-in\.|Search a guest…)/;

async function doorStoreOpened(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    if (typeof indexedDB.databases !== 'function') return false;
    return (await indexedDB.databases()).some((d) => d.name === 'plusone-door');
  });
}

async function expectOutboxDoor(page: Page): Promise<void> {
  await expect(page.getByPlaceholder(DOOR_SEARCH)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder(COCKPIT_SEARCH)).toHaveCount(0);
  await expect.poll(() => doorStoreOpened(page), { message: 'the offline outbox store was never opened', timeout: 20_000 }).toBe(true);
}

async function expectCockpit(page: Page): Promise<void> {
  await expect(page.getByPlaceholder(COCKPIT_SEARCH).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByPlaceholder(DOOR_SEARCH)).toHaveCount(0);
  expect(await doorStoreOpened(page), 'the cockpit opened the door outbox store').toBe(false);
}

async function openDoor(page: Page): Promise<void> {
  await openScreen(page, 'door', DOOR_URL);
}

test.describe('Deur variant (plan decision 14)', () => {
  test('below 1024px (touch or not): Check-in opens the offline-outbox door', async ({ browser }) => {
    const testInfo = test.info();
    const device = deviceFor(testInfo.project.name);
    test.skip(device.width >= CHROME_BREAKPOINT, 'covered by the ≥1024px cases');
    const context = await newProjectContext(browser, testInfo);
    try {
      const page = await context.newPage();
      await openDoor(page);
      await expectOutboxDoor(page);
    } finally {
      await context.close();
    }
  });

  test('touch at ≥1024px (iPad landscape) also gets the offline-outbox door', async ({ browser }) => {
    const testInfo = test.info();
    const device = deviceFor(testInfo.project.name);
    test.skip(!device.touch || device.width < CHROME_BREAKPOINT, 'only touch devices at ≥1024px');
    const context = await newProjectContext(browser, testInfo);
    try {
      const page = await context.newPage();
      await openDoor(page);
      await expect.poll(() => page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await expectOutboxDoor(page);
    } finally {
      await context.close();
    }
  });

  test('fine pointer at ≥1024px: Check-in opens the Event-day cockpit', async ({ browser }) => {
    const testInfo = test.info();
    const device = deviceFor(testInfo.project.name);
    test.skip(device.touch || device.width < CHROME_BREAKPOINT, 'only a fine pointer at ≥1024px');
    const context = await newProjectContext(browser, testInfo);
    try {
      const page = await context.newPage();
      await openDoor(page);
      await expectCockpit(page);
    } finally {
      await context.close();
    }
  });
});
