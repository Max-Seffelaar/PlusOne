// Playwright config for the promo app screens (screens.spec.mjs).
//
//   pnpm promo:seed      # once per fresh stack: the Kelder Nord demo company
//   npx playwright test -c .claude/skills/promo-video/scripts/screens.config.mjs
//
// Starts its own `pnpm dev` on PROMO_PORT (default 3100) from the repo root, so it
// never depends on, or disturbs, a dev server another session runs on 7000. Output:
// PROMO_SCREENS_DIR (default ~/Documents/PlusOne promo/app-screens).
import { defineConfig } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');
const PORT = Number(process.env.PROMO_PORT ?? 3100);

export default defineConfig({
  testDir: here,
  testMatch: /screens\.spec\.mjs$/,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // The first screen pays the dev server's cold compile of /app.
  timeout: 180_000,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Entrance animations would otherwise be caught mid-flight.
    contextOptions: { reducedMotion: 'reduce' },
  },
  projects: [
    {
      name: 'phone',
      use: { browserName: 'chromium', viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    },
    {
      name: 'ipad-landscape',
      use: { browserName: 'chromium', viewport: { width: 1376, height: 1032 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    cwd: repoRoot,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 180_000,
    // DEV_WEBPACK=1 passes through: Turbopack refuses a node_modules junction, which
    // is how a git worktree usually borrows the main checkout's dependencies.
    env: { PORT: String(PORT), ...(process.env.DEV_WEBPACK ? { DEV_WEBPACK: process.env.DEV_WEBPACK } : {}) },
  },
});
