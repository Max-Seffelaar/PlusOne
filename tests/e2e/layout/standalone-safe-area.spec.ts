import { test, expect, type Locator, type Page } from '@playwright/test';
import { deviceFor } from './matrix';
import { newProjectContext } from './probe';
import { underSystemBars } from './safe-area';
import { SEED, type LayoutUser } from './screens';

/**
 * The routes outside the `/app` shell (no shell root padding to lean on):
 * each must pad the safe area itself (`safeAreaPadding`, src/lib/po/safe-area.ts).
 * Same simulated system bars as the shell screens (`safe-area.ts`). The
 * onboarding wizard and the consent screen need an account in a specific
 * state; the `onboarding` flow covers them.
 */
const ROUTES: readonly { id: string; path: string; user?: LayoutUser; ready: (page: Page) => Locator }[] = [
  { id: 'login', path: '/login', ready: (p) => p.getByText(/log in|sign in|email/i).first() },
  { id: 'door-picker', path: '/door', user: 'door', ready: (p) => p.getByRole('heading', { name: 'Door' }) },
  // The standalone door (DoorRoute): no tab bar, so its root owns the bottom inset.
  { id: 'door-route', path: `/door/${SEED.eventId}`, user: 'door', ready: (p) => p.getByPlaceholder('Search a name…') },
  { id: 'not-found', path: '/this-page-does-not-exist', ready: (p) => p.getByText(/404|not found|PLUSONE/i).first() },
];

for (const route of ROUTES) {
  test(`${route.id} (${route.path}): nothing under the system bars on touch`, async ({ browser }) => {
    const testInfo = test.info();
    test.skip(!deviceFor(testInfo.project.name).touch, 'a desktop browser has no system bars over the page');
    const context = await newProjectContext(browser, testInfo, route.user);
    try {
      const page = await context.newPage();
      await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 150_000 });
      await expect(route.ready(page)).toBeVisible({ timeout: 90_000 });
      await page.waitForTimeout(300);
      const covered = await underSystemBars(page);
      expect(covered, `covered by a system bar:\n  · ${covered.join('\n  · ')}`).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
