/**
 * Guards for the native icon + splash wiring (86ey6bft8).
 *
 * The first device test failed because the adaptive icon's foreground was the
 * full lavender tile with the glyph baked in (the launcher mask cropped and
 * shifted it) and `windowSplashScreenAnimatedIcon` was never set, so Android
 * 12+ drew that broken icon on the splash. These fail CI if either regresses.
 * The artwork itself comes from `node scripts/native-icons.mjs`.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const res = resolve(root, 'android/app/src/main/res');
const read = (p: string): string => readFileSync(resolve(res, p), 'utf8');

function styleItems(name: string): Record<string, string> {
  const block = read('values/styles.xml').match(new RegExp(`<style name="${name.replace('.', '\\.')}"[\\s\\S]*?</style>`));
  expect(block, `${name} missing from styles.xml`).not.toBeNull();
  return Object.fromEntries([...block![0].matchAll(/<item name="([^"]+)">([^<]+)<\/item>/g)].map((m) => [m[1], m[2].trim()]));
}

describe('Android splash (launch theme)', () => {
  const items = styleItems('AppTheme.NoActionBarLaunch');

  it('sets windowSplashScreenAnimatedIcon to a drawable that exists', () => {
    const icon = items.windowSplashScreenAnimatedIcon;
    expect(icon).toMatch(/^@drawable\//);
    expect(existsSync(resolve(res, `drawable/${icon.slice('@drawable/'.length)}.xml`))).toBe(true);
  });

  it('draws the icon on a lavender circle over near-black', () => {
    expect(read('values/styles.xml')).toContain('parent="Theme.SplashScreen.IconBackground"');
    expect(items.windowSplashScreenBackground).toBe('@color/plusone_shell_background');
    expect(items.windowSplashScreenIconBackgroundColor).toBe('@color/ic_launcher_background');
  });

  it('ships no full-screen splash bitmaps (they crop and shift on non-2:3 screens)', () => {
    const bitmaps = readdirSync(res).filter((d) => existsSync(resolve(res, d, 'splash.png')));
    expect(bitmaps).toEqual([]);
  });
});

describe('Android adaptive launcher icon', () => {
  for (const file of ['mipmap-anydpi-v26/ic_launcher.xml', 'mipmap-anydpi-v26/ic_launcher_round.xml']) {
    it(`${file} references a separate foreground and background`, () => {
      const xml = read(file);
      const layer = (tag: string): string | undefined => xml.match(new RegExp(`<${tag}\\s+android:drawable="([^"]+)"`))?.[1];
      const foreground = layer('foreground');
      const background = layer('background');
      expect(foreground).toBe('@drawable/ic_launcher_foreground');
      expect(background).toBe('@color/ic_launcher_background');
      expect(layer('monochrome')).toBe(foreground);
    });
  }

  it('the foreground is the mark on transparent, not a baked tile', () => {
    const fg = read('drawable/ic_launcher_foreground.xml');
    expect(fg).toMatch(/^<\?xml[\s\S]*<vector /);
    expect(fg).not.toContain('#B5A6FF');
  });
});
