// @vitest-environment jsdom
/**
 * Tap-target floor: CLAUDE.md requires tap targets of at least 44px.
 *
 * jsdom has no layout engine, so the hit area is derived from the Tailwind
 * classes that produce it: the visible box (`h-[40px] w-[40px]`, `h-10 w-10`)
 * grown by an invisible `::before` ring (`relative` + `before:absolute` +
 * `before:-inset-*`). An absolute box is placed against the padding box, so the
 * element's own border is subtracted from each inset: a 1px-bordered 40px chip
 * with `before:-inset-[3px]` hits at 40 + 2 * (3 - 1) = 44. The real-browser
 * numbers (elementFromPoint + getComputedStyle(el, '::before')) were measured
 * against the fixture harness when this landed; this pins them in CI.
 *
 * Two layers:
 * 1. The kit's header chips (IconBtn, BackBtn, Top's back button) render >= 44.
 * 2. A source ratchet over every `<button>` in `src/`: a new fixed-size button
 *    below 44px fails CI. KNOWN_DEBT listed the sub-44 buttons that predated the
 *    guard; all of them have been fixed, so it is empty and must stay that way.
 */
import '@testing-library/jest-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { BackBtn, ColorSwatches, IconBtn, Toggle, Top, hitArea44 } from './kit';
import * as kitExports from './kit';

const MIN = 44;

// ── class-string geometry ────────────────────────────────────────────────────
// Unprefixed tokens only: `lg:h-[34px]` or `min-h-[44px]` must not count.
const token = (body: string): RegExp => new RegExp(String.raw`(?<![\w:\[-])${body}(?![\w\[-])`);

function visible(cls: string, axis: 'h' | 'w'): number | null {
  const m = token(String.raw`${axis}-(?:\[(\d+(?:\.\d+)?)px\]|(\d+(?:\.5)?))`).exec(cls);
  if (!m) return null;
  return m[1] ? Number(m[1]) : Number(m[2]) * 4;
}

function borderWidth(cls: string): number {
  if (token('border-(?:0|none)').test(cls)) return 0;
  const m = token(String.raw`border(?:-(\d+)|-\[(\d+)px\])?`).exec(cls);
  if (!m) return 0;
  return m[1] ? Number(m[1]) : m[2] ? Number(m[2]) : 1;
}

/** How far `before:-{prop}-[Npx]` pushes the ring out (`before:{prop}-0` is 0), null when unset. */
function inset(cls: string, prop: string): number | null {
  const m = new RegExp(String.raw`(?<![\w-])before:(?:-${prop}-\[(\d+(?:\.\d+)?)px\]|-?${prop}-0)(?![\w\[-])`).exec(cls);
  if (!m) return null;
  return m[1] ? Number(m[1]) : 0;
}

/** Pointer hit box of a button, or null when its class sets no fixed size. */
function hitBox(cls: string): { w: number; h: number } | null {
  const w = visible(cls, 'w');
  const h = visible(cls, 'h');
  if (w == null || h == null) return null;
  const ring = token('relative').test(cls) && /(?<![\w-])before:absolute(?![\w-])/.test(cls);
  if (!ring) return { w, h };
  const all = inset(cls, 'inset');
  const x = inset(cls, 'inset-x') ?? all;
  const y = inset(cls, 'inset-y') ?? all;
  const sides = [inset(cls, 'left') ?? x, inset(cls, 'right') ?? x, inset(cls, 'top') ?? y, inset(cls, 'bottom') ?? y];
  // A side left at `auto` shrinks the empty ::before to 0px on that axis: no ring.
  if (sides.some((v) => v == null)) return { w, h };
  const [l, r, t, bt] = sides as number[];
  const b = borderWidth(cls);
  // The ring starts at the padding box; only what clears the border box adds hit area.
  const past = (v: number): number => Math.max(0, v - b);
  return { w: w + past(l) + past(r), h: h + past(t) + past(bt) };
}

afterEach(cleanup);

describe('hitBox (the measuring stick itself)', () => {
  it('reads the visible size, the border and the ring', () => {
    expect(hitBox('flex h-[40px] w-[40px] border')).toEqual({ w: 40, h: 40 });
    expect(hitBox('h-10 w-10 lg:h-[30px] lg:w-[30px]')).toEqual({ w: 40, h: 40 });
    // Border-box 40 + 2px each side past the 1px border.
    expect(hitBox(`h-[40px] w-[40px] border ${hitArea44}`)).toEqual({ w: 44, h: 44 });
    // Without `relative` the ring would anchor to some ancestor: no credit.
    expect(hitBox("h-[40px] w-[40px] before:absolute before:-inset-[3px]")).toEqual({ w: 40, h: 40 });
    // Lopsided ring (the door SyncBar chips).
    expect(
      hitBox("h-[30px] w-[30px] border relative before:absolute before:-inset-y-[8px] before:-left-[10px] before:-right-[6px]"),
    ).toEqual({ w: 44, h: 44 });
    // One axis only (the kit Toggle): the other side pair must be pinned to 0,
    // or the empty ::before is 0px wide and adds nothing.
    expect(hitBox('h-[28px] w-[46px] relative before:absolute before:inset-x-0 before:-inset-y-[8px]')).toEqual({ w: 46, h: 44 });
    expect(hitBox('h-[28px] w-[46px] relative before:absolute before:-inset-y-[8px]')).toEqual({ w: 46, h: 28 });
    // A 2px border eats 2px of each inset (the colour swatches).
    expect(hitBox('h-[34px] w-[34px] border-2 relative before:absolute before:-inset-[7px]')).toEqual({ w: 44, h: 44 });
  });
});

describe('kit hit rings reach 44 on the controls that use them', () => {
  // Visible heights measured in Chromium (fixture harness, 820 and 1024 touch):
  // a ring's size is only right for the box it was picked for.
  const cases: [string, string, string, number][] = [
    ['Btn sm (Manage, Cancel event)', 'h-[43px] border', kitExports.hitRingY2, 45],
    ['template check-out segment', 'h-[42.8px] border', kitExports.hitRingY2, 44.8],
    ['kit Seg pill', 'h-[39.5px] border', kitExports.hitRingY4, 45.5],
    ['cockpit status segment', 'h-[36.3px]', kitExports.hitRingY4, 44.3],
    ['Quick-add "Add tier"', 'h-[41.5px] border', kitExports.hitRingY4, 47.5],
    ['Promotion range segment', 'h-[35.5px]', kitExports.hitRingY5, 45.5],
    ['Import tier pill', 'h-[36.8px] border', kitExports.hitRingY5, 44.8],
    ['template / cockpit tier chip, Copy link', 'h-[34.8px] border', kitExports.hitRingY6, 44.8],
    ['inline text button (MFA, links jump)', 'h-[18.8px]', kitExports.hitRingY13, 44.8],
  ];
  it.each(cases)('%s', (_name, box, ring, expected) => {
    const hit = hitBox(`w-[100px] ${box} ${ring}`);
    expect(hit?.h).toBeCloseTo(expected, 5);
    expect(hit!.h).toBeGreaterThanOrEqual(MIN);
  });

  it('the Roles stepper ring grows both axes to 44', () => {
    expect(hitBox(`h-[42px] w-[42px] border ${kitExports.hitRing2}`)).toEqual({ w: 44, h: 44 });
  });

  it('Btn sm carries the ring; the full-size Btn needs none', () => {
    render(<kitExports.Btn sm>Small</kitExports.Btn>);
    render(<kitExports.Btn>Large</kitExports.Btn>);
    const has = (el: HTMLElement): boolean => kitExports.hitRingY2.split(' ').every((c) => el.classList.contains(c));
    expect(has(screen.getByRole('button', { name: 'Small' }))).toBe(true);
    expect(has(screen.getByRole('button', { name: 'Large' }))).toBe(false);
  });
});

describe('kit header chips are at least 44x44', () => {
  const expectFloor = (el: HTMLElement): void => {
    const box = hitBox(el.className);
    expect(box).not.toBeNull();
    expect(box!.w).toBeGreaterThanOrEqual(MIN);
    expect(box!.h).toBeGreaterThanOrEqual(MIN);
  };

  it('IconBtn', () => {
    render(<IconBtn name="search" ariaLabel="Zoeken" />);
    expectFloor(screen.getByRole('button', { name: 'Zoeken' }));
  });

  it('BackBtn', () => {
    render(<BackBtn onClick={() => {}} />);
    expectFloor(screen.getByRole('button', { name: t.shared.kit.back }));
  });

  it('Top back button, compact and big', () => {
    render(<Top title="Gasten" onBack={() => {}} />);
    expectFloor(screen.getByRole('button', { name: t.shared.kit.back }));
    cleanup();
    render(<Top big title="Events" onBack={() => {}} />);
    expectFloor(screen.getByRole('button', { name: t.shared.kit.back }));
  });

  it('Toggle', () => {
    render(<Toggle on={false} />);
    expectFloor(screen.getByRole('switch'));
  });

  it('ColorSwatches, enabled and disabled', () => {
    render(<ColorSwatches value="#B5A6FF" onPick={() => {}} isDisabled={(c) => c === '#9DE0C0'} />);
    const dots = screen.getAllByRole('button');
    expect(dots.length).toBeGreaterThan(1);
    dots.forEach(expectFloor);
  });

  it('keeps the visible chip at the design size (the ring is invisible)', () => {
    render(<IconBtn name="search" ariaLabel="Zoeken" />);
    const cls = screen.getByRole('button', { name: 'Zoeken' }).className;
    expect(visible(cls, 'w')).toBe(40);
    expect(visible(cls, 'h')).toBe(40);
  });
});

// ── source ratchet ───────────────────────────────────────────────────────────
/**
 * Sub-44 buttons that predate this guard (file -> count). The 22 row/card
 * controls it started with all have 44px hit areas now, so this stays empty: a
 * new sub-44 button gets a ring (kit `hitArea44`), not an entry here.
 */
const KNOWN_DEBT: Record<string, number> = {};

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(p) ? [p] : [];
  });
}

/** The kit's exported rings: `hitArea44` and every `hitRing*` size. */
const KIT_RINGS: [string, string][] = Object.entries(kitExports as Record<string, unknown>).filter(
  (e): e is [string, string] => (e[0] === 'hitArea44' || e[0].startsWith('hitRing')) && typeof e[1] === 'string',
);

/** Same-file `const X = '...'` string constants, plus the kit's exported rings. */
function stringConsts(src: string): Map<string, string> {
  const map = new Map<string, string>(KIT_RINGS);
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*;/g)) {
    map.set(m[1], m[2] ?? m[3] ?? m[4]);
  }
  return map;
}

function scanButtons(): { sized: number; found: Map<string, string[]> } {
  const found = new Map<string, string[]>();
  let sized = 0;
  for (const file of tsxFiles(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const consts = stringConsts(src);
    // The opening tag runs up to its first child: a `<` that opens a tag (a
    // letter, `/` or `>` follows). A comparison inside an attribute, such as
    // `quotaDefault <= 0 && 'opacity-40'`, must not end it early.
    for (const m of src.matchAll(/<button\b(?:[^<]|<(?![A-Za-z/>]))*/g)) {
      const resolved = m[0].replace(/\b\w+\b/g, (w) => (consts.has(w) ? ` ${consts.get(w)} ` : w));
      const box = hitBox(resolved);
      if (!box) continue;
      sized++;
      if (Math.min(box.w, box.h) >= MIN) continue;
      const rel = relative(ROOT, file).split(sep).join('/');
      const line = src.slice(0, m.index).split('\n').length;
      found.set(rel, [...(found.get(rel) ?? []), `${rel}:${line} (${box.w}x${box.h})`]);
    }
  }
  return { sized, found };
}

describe('no new sub-44 buttons (ratchet)', () => {
  const { sized, found } = scanButtons();

  it('finds fixed-size buttons at all (the scan is not silently empty)', () => {
    expect(sized).toBeGreaterThan(20);
  });

  it('every sub-44 button is known debt, and the debt list is exact', () => {
    const actual = Object.fromEntries([...found].map(([f, hits]) => [f, hits.length]));
    const detail = [...found.values()].flat().join('\n');
    expect(actual, `sub-44 buttons found:\n${detail}\nGive a new button a 44px hit area (kit \`hitArea44\`); if you fixed one, lower KNOWN_DEBT.`).toEqual(KNOWN_DEBT);
  });
});
