/**
 * One source for system-bar insets (design-system.md "Safe area"). The app
 * draws edge-to-edge, and on Android the native shell reports the insets as
 * injected `--safe-area-inset-*` CSS properties, not only through `env()`. The
 * `--safe-*` tokens in globals.css read both; a component that writes
 * `env(safe-area-inset-*)` itself skips the Android value and is invisible to
 * the layout suite's simulated system bars (tests/e2e/layout/safe-area.ts).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

/** Where a raw env() is the point: the token definitions themselves, and the
 *  store-review login page, a self-contained HTML string without globals.css
 *  (it reads the Android property first too). */
const ALLOWED = new Set(['src/app/globals.css', 'src/features/auth/review-login.ts']);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

describe('safe-area insets come from the --safe-* tokens', () => {
  it('no source file writes env(safe-area-inset-*) outside the token definitions', () => {
    const offenders = files(join(root, 'src'))
      .map((p) => relative(root, p).split('\\').join('/'))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /env\(\s*safe-area-inset-/.test(readFileSync(join(root, rel), 'utf8')));
    expect(offenders, 'use var(--safe-top|right|bottom|left) or safeAreaPadding() instead').toEqual([]);
  });

  it('globals.css defines all four tokens, Android property first, env() as the fallback', () => {
    const css = readFileSync(join(root, 'src/app/globals.css'), 'utf8');
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(css).toContain(`--safe-${side}: var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px));`);
    }
  });

  it('the review-login page reads the Android property before env()', () => {
    const src = readFileSync(join(root, 'src/features/auth/review-login.ts'), 'utf8');
    expect(src).not.toMatch(/padding:\s*env\(safe-area-inset/);
    expect(src).toContain('var(--safe-area-inset-top, env(safe-area-inset-top))');
  });
});
