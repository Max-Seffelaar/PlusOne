/**
 * T1 (z8uq9m0fzj) — touch density follows the POINTER, not the width.
 *
 * design-system.md "Breakpoints & tablet": the sidebar chrome starts at 1024px,
 * and iPad landscape (1024/1180/1366px) lands there — a desktop WIDTH driven by a
 * finger. So a responsive prefix alone (`lg:h-[30px]`) must never shrink a size
 * below the 44px tap floor: that shrink is only allowed behind a fine pointer,
 * `lg:[@media(pointer:fine)]:h-[30px]`, which an iPad never matches.
 *
 * The kit's own tap-target guard (src/components/po/kit.tap-target.test.tsx)
 * deliberately ignores prefixed tokens — it checks the base (touch) size. This
 * is the other half: it fails on a width-prefixed size under 44px.
 *
 * Scans the po surface and the door/cockpit features it renders.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const DIRS = ['src/components/po', 'src/features/po', 'src/features/door'];
const MIN = 44;

// A width-prefixed size utility applied directly (no pointer gate between the
// prefix and the utility): `lg:h-[30px]`, `md:min-h-9`, `max-lg:size-8`, …
const PREFIXED_SIZE =
  /(?<![\w\]-])((?:max-)?(?:sm|md|lg|xl|2xl)):((?:min-)?(?:h|w|size)-(?:\[(\d+(?:\.\d+)?)px\]|(\d+(?:\.5)?)))(?![\w\[-])/g;

/**
 * Files that still shrink below 44px on width alone, with the reason. Only ever
 * shrink this list.
 *
 * - kit.tsx: the InfoTip's close button (`lg:h-[36px]`), and its popover-vs-sheet
 *   switch keys on `lg:` too. kit.tsx is frozen until N1 (86ey6bfam) merges; the
 *   fix is the same `lg:[@media(pointer:fine)]:` gate — T1 follow-up.
 */
const KNOWN_DEBT: Record<string, string> = {
  'src/components/po/kit.tsx': 'InfoTip close button — frozen until N1 (86ey6bfam) merges',
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

function violations(src: string): string[] {
  const hits: string[] = [];
  for (const m of src.matchAll(PREFIXED_SIZE)) {
    const px = m[3] ? Number(m[3]) : Number(m[4]) * 4;
    if (px < MIN) hits.push(`${m[1]}:${m[2]}`);
  }
  return hits;
}

describe('touch density follows the pointer (T1)', () => {
  it('the matcher flags a width-only shrink and passes a pointer-gated one', () => {
    expect(violations('h-[44px] lg:h-[30px]')).toEqual(['lg:h-[30px]']);
    expect(violations('max-lg:w-8 md:min-h-9')).toEqual(['max-lg:w-8', 'md:min-h-9']);
    expect(violations('h-[44px] lg:[@media(pointer:fine)]:h-[30px]')).toEqual([]);
    // Growing, or not a tap size at all, is fine.
    expect(violations('lg:w-[300px] md:max-w-[680px] lg:h-[44px] lg:w-auto')).toEqual([]);
  });

  it('no po/door source shrinks a size below 44px on width alone', () => {
    const offenders: string[] = [];
    for (const file of DIRS.flatMap((d) => walk(join(ROOT, d)))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (KNOWN_DEBT[rel]) continue;
      const hits = violations(readFileSync(file, 'utf8'));
      if (hits.length) offenders.push(`${rel}: ${hits.join(', ')}`);
    }
    expect(offenders, 'gate the shrink behind a fine pointer: lg:[@media(pointer:fine)]:h-[30px]').toEqual([]);
  });

  it('every KNOWN_DEBT entry still has debt (a fixed file must leave the list)', () => {
    for (const rel of Object.keys(KNOWN_DEBT)) {
      expect(violations(readFileSync(join(ROOT, rel), 'utf8')), rel).not.toEqual([]);
    }
  });
});
