import type { Page } from '@playwright/test';
import { join } from 'node:path';
import { shellMounted } from '../layout/shell-ready';

/** Output root: `store-screenshots/<set>/<nn>-<screen>.png` (gitignored, CI artifact). */
export const STORE_DIR = join(process.cwd(), 'store-screenshots');

/**
 * dev-login as `email` straight onto `path`, then wait for the REAL shell — the
 * layout suite's `shellMounted` gate (light DOM only, boot screen gone), never
 * Next's shadow-DOM dev indicator. Unlike the layout suite's `openScreen` this
 * takes an e-mail, because the store demo user is not one of its seed users,
 * and runs one worker so it needs no login-race retry.
 */
export async function openAs(page: Page, email: string, path: string): Promise<void> {
  const login = `/auth/dev-login?email=${encodeURIComponent(email)}&next=${encodeURIComponent(path)}`;
  const expected = path.split('?')[0];
  await page.goto(login, { waitUntil: 'domcontentloaded', timeout: 150_000 });
  await page.waitForURL((u) => u.pathname === expected || u.pathname === '/login' || u.pathname === '/consent', {
    timeout: 90_000,
  });
  const landed = new URL(page.url()).pathname;
  if (landed !== expected) {
    throw new Error(`dev-login as ${email} landed on ${landed}, not ${expected} — did scripts/store-screenshot-seed.mjs run?`);
  }
  await page.waitForFunction(shellMounted, undefined, { timeout: 120_000 });
  await settle(page);
}

/** Same bounded settle as the layout suite: network quiet, skeletons gone. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => undefined);
  await page
    .waitForFunction(() => document.querySelectorAll('.animate-pulse').length === 0, undefined, { timeout: 15_000 })
    .catch(() => undefined);
}

/**
 * Store-shot hygiene, applied after the screen has settled:
 *   · Next's dev-tools indicator (`<nextjs-portal>`, a shadow-DOM host) hidden —
 *     the dev server is required for dev-login, its badge never belongs in a listing;
 *   · transient toasts (the kit's `po-anim-toast` frame, shell.tsx) given time to
 *     leave instead of being frozen mid-slide;
 *   · caret hidden + animations disabled at capture time (see `shoot`).
 * The app's own safe-area handling is left as is.
 */
export async function cleanForShot(page: Page): Promise<void> {
  // CSSOM, not an injected <style>: the app's CSP governs <style> tags, never
  // a property set from script.
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('nextjs-portal'))) {
      (el as HTMLElement).style.setProperty('display', 'none', 'important');
    }
  });
  await page
    .waitForFunction(() => !document.querySelector('.po-anim-toast'), undefined, { timeout: 8_000 })
    .catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

/**
 * Read width, height and colour type from a PNG's IHDR chunk. Stores reject
 * alpha (Apple: "no alpha channels", Play: "24-bit PNG (no alpha)"), so the
 * spec asserts colour type 2 (truecolour RGB) rather than trusting Chromium.
 */
export function pngInfo(buf: Buffer): { width: number; height: number; colorType: number; bitDepth: number } {
  const SIG = '89504e470d0a1a0a';
  if (buf.subarray(0, 8).toString('hex') !== SIG || buf.subarray(12, 16).toString('ascii') !== 'IHDR') {
    throw new Error('not a PNG');
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bitDepth: buf[24], colorType: buf[25] };
}

/** File name `<nn>-<screen>.png`. */
export function shotFile(order: number, id: string): string {
  return `${String(order).padStart(2, '0')}-${id}.png`;
}
