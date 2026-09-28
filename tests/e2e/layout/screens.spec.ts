import { test, expect, type BrowserContext } from '@playwright/test';
import { CHROME_BREAKPOINT, deviceFor } from './matrix';
import { LAYOUT_SCREENS } from './screens';
import { knownIssue, type LayoutCheck } from './known-issues';
import {
  fullScreenshot,
  measure,
  MIN_HIT,
  newProjectContext,
  openScreen,
  recordFailures,
  type LayoutSnapshot,
} from './probe';

/**
 * QA-1: the machine-checkable half of a UI handoff, for every `po` screen in
 * every project of the device matrix (`matrix.ts`). Per screen × project the
 * screen is loaded ONCE (beforeAll) and four independent checks read that
 * snapshot:
 *   overflow         nothing reaches past the right edge of the viewport
 *   tap-targets      touch projects: every visible control hits ≥44×44
 *   chrome           bottom tabs <1024px, sidebar ≥1024px (use-viewport.ts)
 *   console-network  no console errors, no failed requests (allowlists in probe.ts)
 * plus a full-page screenshot per screen × project for human review.
 */

function fixmeIfKnown(screen: string, check: LayoutCheck, project: string): void {
  const reason = knownIssue(screen, check, project);
  test.fixme(reason !== null, reason ?? '');
}

const list = (items: readonly string[]): string => (items.length ? `\n  · ${items.join('\n  · ')}` : '');

for (const screen of LAYOUT_SCREENS) {
  test.describe(`${screen.id} (${screen.path})`, () => {
    // One worker, in order, sharing the beforeAll snapshot. `default` (not
    // `serial`): one failing check must not skip the others.
    test.describe.configure({ mode: 'default' });

    let context: BrowserContext | undefined;
    let snap: LayoutSnapshot;

    test.beforeAll(async ({ browser }, testInfo) => {
      context = await newProjectContext(browser, testInfo);
      const page = await context.newPage();
      const failures = recordFailures(page);
      await openScreen(page, screen.user, screen.path);
      const measured = await measure(page);
      // Failures are read AFTER the screenshot, so anything the resize for the
      // full-page capture triggers counts too.
      const screenshot = await fullScreenshot(page, testInfo.project.name, screen.id);
      snap = { ...measured, ...failures, screenshot };
    });

    test.afterAll(async () => {
      await context?.close();
    });

    test('no horizontal overflow', async () => {
      const testInfo = test.info();
      fixmeIfKnown(screen.id, 'overflow', testInfo.project.name);
      expect(snap.finalPath, 'landed on a different screen (gate/redirect?)').toBe(screen.path.split('?')[0]);
      expect(snap.docScrollWidth, 'document scrolls sideways').toBeLessThanOrEqual(snap.innerWidth);
      expect(
        snap.overflow,
        `elements past the right edge (${snap.innerWidth}px):${list(snap.overflow.map((o) => `${o.what} → ${o.right}px`))}`,
      ).toEqual([]);
    });

    test('tap targets are at least 44×44 on touch', async () => {
      const testInfo = test.info();
      const device = deviceFor(testInfo.project.name);
      test.skip(!device.touch, 'density is pointer-keyed: sub-44 is allowed behind (pointer: fine)');
      fixmeIfKnown(screen.id, 'tap-targets', testInfo.project.name);
      expect(snap.measuredTargets, 'no interactive element measured — did the screen render?').toBeGreaterThan(0);
      expect(
        snap.smallTargets,
        `controls with a hit box under ${MIN_HIT}×${MIN_HIT}:${list(snap.smallTargets.map((s) => `${s.what} ${s.w}×${s.h}`))}`,
      ).toEqual([]);
    });

    test('chrome follows the 1024px breakpoint', async () => {
      const testInfo = test.info();
      const device = deviceFor(testInfo.project.name);
      fixmeIfKnown(screen.id, 'chrome', testInfo.project.name);
      if (device.width < CHROME_BREAKPOINT) {
        expect(snap.sidebar.present, 'sidebar rendered below 1024px').toBe(false);
        expect(snap.tabBar.present, 'no bottom tab bar below 1024px').toBe(true);
        expect(snap.tabBar.bottomGap, 'tab bar is not docked to the bottom edge').toBeLessThanOrEqual(1);
      } else {
        expect(snap.tabBar.present, 'bottom tab bar rendered at ≥1024px').toBe(false);
        expect(snap.sidebar.present, 'no sidebar at ≥1024px').toBe(true);
        expect(snap.sidebar.width, 'sidebar is not the 252px column').toBe(252);
        expect(snap.sidebar.left).toBe(0);
      }
    });

    test('no console errors or failed requests', async () => {
      const testInfo = test.info();
      fixmeIfKnown(screen.id, 'console-network', testInfo.project.name);
      expect(snap.consoleErrors, `console errors:${list(snap.consoleErrors)}`).toEqual([]);
      expect(snap.failedRequests, `failed requests:${list(snap.failedRequests)}`).toEqual([]);
    });
  });
}
