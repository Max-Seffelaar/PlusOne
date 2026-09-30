import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { LAYOUT_PROJECTS } from './tests/e2e/layout/matrix';

/**
 * QA-1 layout/visual suite (`pnpm e2e:layout`). Same local stack, same dev
 * server, same dev-login as `e2e:smoke` — importing the base config reuses its
 * `.env.local` loader, `baseURL` and `webServer` — but with the device matrix
 * as projects and its own test dir.
 *
 * Parallel on purpose, unlike the base suite's single worker: every test here
 * only READS the seed (the one write, consent + MFA snooze in `global-setup`,
 * runs once before any worker starts), so there is no shared state to order.
 * Every screen is the same `/app/[[...segments]]` route, so the dev server
 * compiles it once and each further load is a client render.
 */
export default defineConfig({
  ...base,
  testDir: './tests/e2e/layout',
  testIgnore: [],
  globalSetup: './tests/e2e/layout/global-setup.ts',
  globalTeardown: './tests/e2e/layout/global-teardown.ts',
  fullyParallel: true,
  workers: process.env.CI ? 3 : undefined,
  // A measurement is deterministic; a retry only doubles the cost of a real
  // finding. Load flakes surface as a failed load, which is itself a finding.
  retries: 0,
  // The first test in each worker pays the dev server's first compile of /app.
  timeout: 180_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...base.use,
    // Entrance animations would otherwise be mid-flight in a measurement or a
    // screenshot; design-system.md gates them behind prefers-reduced-motion.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: LAYOUT_PROJECTS,
});
