import { defineConfig } from '@playwright/test';
import base from './playwright.config';
import { STORE_PROJECTS } from './tests/e2e/store/sets';

/**
 * Store listing assets (`pnpm store:screenshots`, 86ey6bf8k): the App Store /
 * Play screenshot sets + the Play feature graphic, written to
 * `store-screenshots/<set>/` (gitignored; the `store-screenshots` workflow
 * uploads it). Reuses the base config's `.env.local` loader, `baseURL` and dev
 * server — dev-login needs `next dev` against the LOCAL stack, which is also
 * why this can never point at prod.
 *
 * Demo data comes from `scripts/store-screenshot-seed.mjs`, which the package
 * script runs first; `global-setup.ts` refuses to start without it.
 *
 * One worker, no retries: the run is short, a shot is either right or a
 * finding, and a single worker keeps the one demo user's dev-login free of the
 * token race the parallel layout suite has to retry around.
 */
export default defineConfig({
  ...base,
  testDir: './tests/e2e/store',
  testIgnore: [],
  globalSetup: './tests/e2e/store/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The first shot pays the dev server's cold compile of /app.
  timeout: 180_000,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...base.use,
    // Entrance animations would otherwise be caught mid-flight (design-system.md
    // gates them behind prefers-reduced-motion).
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: STORE_PROJECTS,
});
