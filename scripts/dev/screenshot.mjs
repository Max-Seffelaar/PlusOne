// Screenshot one /app screen against the fixture backend (scripts/dev/fake-supabase.mjs).
//
//   pnpm shot <name> <path> [desktop|mobile] [email]
//   pnpm shot home /app
//   pnpm shot door-mobile "/app/door?event=c0000000-0000-4000-8000-000000000001" mobile door@plusone.test
//
// Logs in through the app's own /auth/dev-login route (so the real cookie path is
// exercised), waits for the live queries, and writes .screenshots/<name>.png.
// Base URL: SHOT_BASE_URL (default http://localhost:7100 = `pnpm dev:fake`).
// Fixture ids (see fake-supabase.mjs): event FRENZY c0000000-…-0001 (tonight),
// Saturday Sessions …-0002 (next week), Opening Night …-0003 (past); guests
// d0000000-…-0001…; users manager@ / staff@ / door@plusone.test.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const [, , name, path = '/app', viewport = 'desktop', email = 'manager@plusone.test'] =
  process.argv;
if (!name) {
  console.error('usage: pnpm shot <name> <path> [desktop|mobile] [email]');
  process.exit(2);
}
const base = process.env.SHOT_BASE_URL ?? 'http://localhost:7100';
const mobile = viewport === 'mobile';
mkdirSync('.screenshots', { recursive: true });

// Prefer the project's Playwright Chromium; fall back to the container-wide one
// (Claude Code web ships /opt/pw-browsers/chromium and no per-version download).
async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    const fallback = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
    if (!existsSync(fallback)) throw e;
    return chromium.launch({ executablePath: fallback });
  }
}

const browser = await launch();
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
  isMobile: mobile,
  hasTouch: mobile,
  colorScheme: 'dark',
});
const page = await ctx.newPage();
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text()))
    console.log('console.error:', m.text().slice(0, 200));
});
await page.goto(
  `${base}/auth/dev-login?email=${encodeURIComponent(email)}&next=${encodeURIComponent(path)}`,
  {
    waitUntil: 'domcontentloaded',
    timeout: 90_000,
  }
);
await page.waitForTimeout(Number(process.env.SHOT_WAIT_MS ?? 2500));
const out = `.screenshots/${name}.png`;
await page.screenshot({ path: out, fullPage: process.env.SHOT_FULL === '1' });
console.log(`${out}  ←  ${page.url()}`);
await browser.close();
