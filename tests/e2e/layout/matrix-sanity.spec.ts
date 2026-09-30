import { test, expect } from '@playwright/test';
import { deviceFor } from './matrix';

/**
 * The matrix is only worth something if each project really emulates what its
 * name claims. Guards the emulation itself (no app, no login): width, and the
 * pointer media query the density axis and the Deur variant key on.
 */
test('the project emulates its declared width and pointer', async ({ page }) => {
  const device = deviceFor(test.info().project.name);
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><body></body>');
  const env = await page.evaluate(() => ({
    width: window.innerWidth,
    coarse: matchMedia('(pointer: coarse)').matches,
    fine: matchMedia('(pointer: fine)').matches,
    touchPoints: navigator.maxTouchPoints,
  }));
  expect(env.width).toBe(device.width);
  expect(env.coarse, '(pointer: coarse)').toBe(device.touch);
  expect(env.fine, '(pointer: fine)').toBe(!device.touch);
  expect(env.touchPoints > 0, 'navigator.maxTouchPoints').toBe(device.touch);
});
