import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';
import base from '../../playwright.config';
import { FLOW_PROJECTS, type FlowOptions } from './harness';

/**
 * QA-0 flow harness config — run it through `pnpm qa:flows` (scripts/flow-shots/run.mjs),
 * which picks the flow files and builds the contact sheet afterwards.
 *
 * Same local stack, dev server and dev-login as `e2e:smoke` and `e2e:layout`
 * (the base config's `.env.local` loader, `baseURL` and `webServer`); the
 * projects are the four flow variants built from the layout matrix.
 *
 * One worker: flows write (they create accounts, venues, consents), and the
 * dev server compiles each route once on its first hit, so serial runs are
 * both deterministic and barely slower.
 */
const ROOT = resolve(__dirname, '../..');

export default defineConfig<FlowOptions>({
  ...base,
  testDir: __dirname,
  testMatch: /\.flow\.ts$/,
  testIgnore: [],
  workers: 1,
  fullyParallel: false,
  // A retry would overwrite the first attempt's screenshots with a second
  // attempt's; a flaky step is itself a finding for the PR.
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  outputDir: resolve(ROOT, 'test-results/flows'),
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    ...base.use,
    actionTimeout: 60_000,
    navigationTimeout: 90_000,
    contextOptions: { reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
    // Escape hatch for containers whose pre-installed Chromium is not the
    // build this Playwright version pins (CI installs the pinned one).
    launchOptions: process.env.PW_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PW_CHROMIUM_EXECUTABLE } : {},
  },
  webServer: base.webServer && !Array.isArray(base.webServer) ? { ...base.webServer, cwd: ROOT } : base.webServer,
  projects: FLOW_PROJECTS,
});
