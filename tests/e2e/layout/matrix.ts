import type { Project } from '@playwright/test';

/**
 * QA-1 device matrix (design-system.md "Breakpoints & tablet"). Every width is
 * chosen to sit on one side of a real switch:
 *   390  phone                   → bottom tabs, phone content layout
 *   768  iPad portrait            → bottom tabs, `md:` content layout
 *   1024 iPad Pro 12.9" portrait  → sidebar (chrome switch is width-only), touch
 *   1366 iPad Pro landscape       → sidebar, touch
 *   1280 laptop                   → sidebar, fine pointer
 *
 * Touch projects set `isMobile` + `hasTouch`, which is what makes Chromium
 * report `(pointer: coarse)` — the key the density axis and plan decision 14
 * (Deur variant) switch on. `matrix-sanity.spec.ts` asserts that, so a
 * Playwright upgrade that changes the emulation fails loudly instead of
 * silently turning every "touch" project into a mouse one.
 *
 * Chromium only: CI installs one browser, and the checks are geometric, not
 * engine quirks. Real-WebKit/iPad rendering stays on the human checklist.
 */
export interface LayoutDevice {
  name: string;
  width: number;
  height: number;
  touch: boolean;
}

export const LAYOUT_DEVICES: readonly LayoutDevice[] = [
  { name: 'phone-390-touch', width: 390, height: 844, touch: true },
  { name: 'tablet-768-touch', width: 768, height: 1024, touch: true },
  { name: 'ipadpro-1024-touch', width: 1024, height: 1366, touch: true },
  { name: 'ipad-1366-touch', width: 1366, height: 1024, touch: true },
  { name: 'laptop-1280-mouse', width: 1280, height: 800, touch: false },
];

/** The ONE chrome breakpoint (use-viewport.ts): sidebar at ≥1024px. */
export const CHROME_BREAKPOINT = 1024;

export const LAYOUT_PROJECTS: Project[] = LAYOUT_DEVICES.map((d) => ({
  name: d.name,
  use: {
    browserName: 'chromium',
    viewport: { width: d.width, height: d.height },
    isMobile: d.touch,
    hasTouch: d.touch,
    // 1x everywhere: geometry is DPR-independent, and 2x screenshots would
    // quadruple the CI artifact for no extra signal.
    deviceScaleFactor: 1,
  },
}));

/** The matrix entry for the running project (tests read it from testInfo). */
export function deviceFor(projectName: string): LayoutDevice {
  const d = LAYOUT_DEVICES.find((x) => x.name === projectName);
  if (!d) throw new Error(`unknown layout project "${projectName}" — run via pnpm e2e:layout`);
  return d;
}
