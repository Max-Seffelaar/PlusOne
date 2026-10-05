import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_DIR, pngInfo } from './capture';
import { FEATURE_GRAPHIC } from './sets';

/**
 * Google Play feature graphic, 1024×500 (86ey6bf8k): `feature-graphic.html`
 * rendered to a 24-bit PNG.
 *
 * Fonts: the app's OWN Bricolage Grotesque + Hanken Grotesk, exactly as
 * `src/app/layout.tsx` ships them via `next/font` (self-hosted under
 * `/_next/static/media`) — no CDN. The spec opens the auth-free landing page on
 * the running dev server, copies its `@font-face` rules and the two family
 * names behind `--font-display` / `--font-body`, then renders the template on
 * that same origin so the font URLs resolve.
 *
 * Icon: `native/icon/plusone-icon.svg`, the generated "+1"-on-lavender master
 * every app/store icon is rendered from (scripts/native-icons.mjs).
 */
test('Play feature graphic', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 150_000 });
  await page.evaluate(() => document.fonts.ready);

  const fonts = await page.evaluate(() => {
    const faces: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet: not ours
      }
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSFontFaceRule) {
          // Resolve the relative `url(/_next/...)` against the sheet, so the
          // rule still works once inlined into the template.
          const base = sheet.href ?? document.baseURI;
          faces.push(rule.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_m, _q, u: string) => `url("${new URL(u, base).href}")`));
        }
      }
    }
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const pick = (name: string): string => (root.getPropertyValue(name) || body.getPropertyValue(name)).trim();
    return { faces, display: pick('--font-display'), body: pick('--font-body') };
  });
  expect(fonts.display, 'the app exposes --font-display (next/font, src/app/layout.tsx)').not.toBe('');
  expect(fonts.body, 'the app exposes --font-body (next/font, src/app/layout.tsx)').not.toBe('');
  expect(fonts.faces.length, 'the landing page carries the app font @font-face rules').toBeGreaterThan(0);

  const icon = readFileSync(join(process.cwd(), 'native/icon/plusone-icon.svg'), 'utf8')
    .replace(/<\?xml[^>]*\?>/, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  const html = readFileSync(join(__dirname, 'feature-graphic.html'), 'utf8')
    .replace('/*FONT_FACES*/', fonts.faces.join('\n'))
    .replace('/*DISPLAY_FAMILY*/', fonts.display)
    .replace('/*BODY_FAMILY*/', fonts.body)
    .replace('<!--ICON-->', icon);

  // setContent keeps the page on the app origin, so the font URLs load same-origin.
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const usesAppFonts = await page.evaluate(
    // The primary (non-fallback) family of each stack must have loaded.
    ([display, body]) => {
      const first = (stack: string): string => stack.split(',')[0].trim();
      return document.fonts.check(`800 104px ${first(display)}`) && document.fonts.check(`500 31px ${first(body)}`);
    },
    [fonts.display, fonts.body] as const,
  );
  expect(usesAppFonts, 'the app fonts loaded inside the template').toBe(true);

  const png = await page.screenshot({ type: 'png', animations: 'disabled' });
  const info = pngInfo(png);
  expect({ width: info.width, height: info.height }).toEqual({ width: FEATURE_GRAPHIC.width, height: FEATURE_GRAPHIC.height });
  expect(info.colorType, 'Play: 24-bit PNG, no alpha').toBe(2);

  const dir = join(STORE_DIR, FEATURE_GRAPHIC.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'feature-graphic-1024x500.png'), png);
});
