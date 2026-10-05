import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { measure, newProjectContext } from '../layout/probe';
import { STORE_DIR, cleanForShot, openAs, pngInfo, shotFile } from './capture';
import { STORE_DEMO, STORE_SHOTS, expectsSidebar, pixelSize, storeSetFor } from './sets';

/**
 * One screenshot per shot × store set (86ey6bf8k). Each test is a fresh
 * context — the layout suite's `newProjectContext` (device options + Club
 * Vesper pinned as the active venue) — logged in as the store demo admin.
 *
 * Asserted, because a store upload would otherwise be the first to notice:
 *   · the PNG is EXACTLY the set's pixel size and has no alpha channel;
 *   · the chrome matches the set (sidebar ≥1024 CSS px, bottom tabs below);
 *   · the Deur tab renders the touch/outbox door, never the desktop cockpit.
 */
for (const [id, shot] of Object.entries(STORE_SHOTS)) {
  test(`store shot: ${id}`, async ({ browser }, testInfo) => {
    const set = storeSetFor(testInfo.project.name);
    test.skip(!set.shots.includes(id as keyof typeof STORE_SHOTS), `${set.name} does not carry the ${id} shot`);

    const context = await newProjectContext(browser, testInfo);
    const page = await context.newPage();
    try {
      await openAs(page, STORE_DEMO.email, shot.path);

      // The layout suite's own chrome/pointer probe, so "sidebar" and "tab bar"
      // mean exactly what they mean in QA-1.
      const m = await measure(page);
      expect(m.pointerCoarse, 'store sets emulate a touch device (plan decision 14)').toBe(true);
      const wide = expectsSidebar(set);
      expect({ sidebar: m.sidebar.present, tabBar: m.tabBar.present }, `${set.name} chrome`).toEqual({
        sidebar: wide,
        tabBar: !wide,
      });

      if (id === 'door') {
        // The outbox door's own search (door-variant.spec.ts marker), never the cockpit's.
        await expect(page.getByPlaceholder('Search a name…')).toBeVisible({ timeout: 60_000 });
      }

      await cleanForShot(page);
      const png = await page.screenshot({ animations: 'disabled', caret: 'hide', type: 'png' });
      const info = pngInfo(png);
      expect({ width: info.width, height: info.height }, `${set.name} pixel size`).toEqual(pixelSize(set));
      expect(info.colorType, 'PNG colour type 2 = RGB, no alpha (both stores reject alpha)').toBe(2);

      const dir = join(STORE_DIR, set.name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, shotFile(shot.order, id)), png);
    } finally {
      await context.close();
    }
  });
}
