/**
 * T1 (z8uq9m0fzj) — content layout switches at `md:` (768px), never `lg:`.
 *
 * design-system.md "Breakpoints & tablet": an iPad-portrait column (768–834px,
 * bottom tabs) is as wide as the desktop column at 1024px (1024 − 252 = 772px),
 * so the grids, tables and horizontal cards that work there fit an iPad portrait
 * too. `lg:` is reserved for things that really hang on the sidebar chrome — and
 * no screen does: the chrome lives in the shell. The only `lg:` a screen may
 * carry is the fine-pointer density gate, `lg:[@media(pointer:fine)]:` (see
 * touch-density.test.ts).
 *
 * Session 1 moved every screen but the two promotion grids (fenced behind N1);
 * session 2 moved those, so this holds for every screen with no allowlist.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCREENS = 'src/components/po/screens';

// Any `lg:` / `max-lg:` variant that is not immediately the pointer gate.
const WIDTH_ONLY_LG = /(?<![\w\]-])((?:max-)?lg:)(?!\[@media\(pointer:fine\)\]:)[\w\[\]\-:./%#()@,]+/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function hits(src: string): string[] {
  return [...src.matchAll(WIDTH_ONLY_LG)].map((m) => m[0]);
}

describe('screens switch content layout at md, not lg (T1)', () => {
  it('the matcher flags a width-only lg: and passes md: and the pointer gate', () => {
    expect(hits('flex lg:grid lg:grid-cols-2 max-lg:hidden')).toEqual(['lg:grid', 'lg:grid-cols-2', 'max-lg:hidden']);
    expect(hits('md:grid md:grid-cols-2 lg:[@media(pointer:fine)]:h-[30px]')).toEqual([]);
  });

  it('no screen carries a width-only lg: class', () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT, SCREENS))) {
      const found = hits(readFileSync(file, 'utf8'));
      if (found.length) offenders.push(`${relative(ROOT, file).split(sep).join('/')}: ${found.join(', ')}`);
    }
    expect(offenders, 'use md: for content layout; lg: only as lg:[@media(pointer:fine)]:').toEqual([]);
  });
});
