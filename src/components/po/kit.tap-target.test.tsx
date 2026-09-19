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
 *    below 44px fails CI. KNOWN_DEBT lists the sub-44 buttons that predate the
 *    guard; the count per file must match exactly, so fixing one forces the
 *    entry down and the list can only shrink.
 */
import '@testing-library/jest-dom';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { t } from '@/lib/i18n';
import { BackBtn, IconBtn, Top, hitArea44 } from './kit';

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

/** How far `before:-{prop}-[Npx]` pushes the ring out, 0 when absent. */
function inset(cls: string, prop: string): number | null {
  const m = new RegExp(String.raw`(?<![\w-])before:-${prop}-\[(\d+(?:\.\d+)?)px\](?![\w\[-])`).exec(cls);
  return m ? Number(m[1]) : null;
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
  const b = borderWidth(cls);
  // The ring starts at the padding box; only what clears the border box adds hit area.
  const past = (v: number | null): number => Math.max(0, (v ?? 0) - b);
  return {
    w: w + past(inset(cls, 'left') ?? x) + past(inset(cls, 'right') ?? x),
    h: h + past(inset(cls, 'top') ?? y) + past(inset(cls, 'bottom') ?? y),
  };
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

  it('keeps the visible chip at the design size (the ring is invisible)', () => {
    render(<IconBtn name="search" ariaLabel="Zoeken" />);
    const cls = screen.getByRole('button', { name: 'Zoeken' }).className;
    expect(visible(cls, 'w')).toBe(40);
    expect(visible(cls, 'h')).toBe(40);
  });
});

// ── source ratchet ───────────────────────────────────────────────────────────
/**
 * Sub-44 buttons that predate this guard (file -> count). Row/card/list controls,
 * not screen headers; each is its own follow-up. Only ever lower these.
 */
const KNOWN_DEBT: Record<string, number> = {
  'src/components/po/influencer-stats.tsx': 2, // 26px clear-search, 32px close
  'src/components/po/kit.tsx': 1, // Toggle switch, 46x28
  'src/components/po/screens/events.tsx': 1, // 38px event-row cog
  'src/components/po/screens/events/edit.tsx': 1, // 34px quota stepper
  'src/components/po/screens/events/tier-form.tsx': 1, // 34px colour swatch
  'src/components/po/screens/guests/_shared.tsx': 1, // 30px colour swatch
  'src/components/po/screens/guests/list-shared.tsx': 2, // 18/20px inline controls
  'src/components/po/screens/guests/profile.tsx': 3, // 22px inline, 38px contact-row star + add
  'src/components/po/screens/home.tsx': 2, // 38px carousel pager
  'src/components/po/screens/settings/venue.tsx': 2, // 34px quota stepper
  'src/components/po/screens/templates.tsx': 1, // 34px colour swatch
  'src/features/door/components/CheckInList.tsx': 1, // 30px clear-search
  'src/features/door/components/Taken.tsx': 1, // 26px task check
  'src/features/po/eventday/CockpitGuestRow.tsx': 1, // 40px check-in slot (desktop cockpit)
  'src/features/po/eventday/CockpitTasksCard.tsx': 1, // 22px task check
  'src/features/po/eventday/EventDayCockpit.tsx': 1, // 30px
};

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return tsxFiles(p);
    return p.endsWith('.tsx') && !/\.(test|spec)\.tsx$/.test(p) ? [p] : [];
  });
}

/** Same-file `const X = '...'` string constants, plus the kit's exported ring. */
function stringConsts(src: string): Map<string, string> {
  const map = new Map<string, string>([['hitArea44', hitArea44]]);
  for (const m of src.matchAll(/\bconst\s+(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`$]*)`)\s*;/g)) {
    map.set(m[1], m[2] ?? m[3] ?? m[4]);
  }
  return map;
}

function sub44Buttons(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of tsxFiles(join(ROOT, 'src'))) {
    const src = readFileSync(file, 'utf8');
    const consts = stringConsts(src);
    // The opening tag runs up to its first child (`<`); attributes hold no JSX.
    for (const m of src.matchAll(/<button\b[^<]*/g)) {
      const resolved = m[0].replace(/\b\w+\b/g, (w) => (consts.has(w) ? ` ${consts.get(w)} ` : w));
      const box = hitBox(resolved);
      if (!box || Math.min(box.w, box.h) >= MIN) continue;
      const rel = relative(ROOT, file).split(sep).join('/');
      const line = src.slice(0, m.index).split('\n').length;
      found.set(rel, [...(found.get(rel) ?? []), `${rel}:${line} (${box.w}x${box.h})`]);
    }
  }
  return found;
}

describe('no new sub-44 buttons (ratchet)', () => {
  const found = sub44Buttons();

  it('finds buttons at all (the scan is not silently empty)', () => {
    expect(found.size).toBeGreaterThan(0);
  });

  it('every sub-44 button is known debt, and the debt list is exact', () => {
    const actual = Object.fromEntries([...found].map(([f, hits]) => [f, hits.length]));
    const detail = [...found.values()].flat().join('\n');
    expect(actual, `sub-44 buttons found:\n${detail}\nGive a new button a 44px hit area (kit \`hitArea44\`); if you fixed one, lower KNOWN_DEBT.`).toEqual(KNOWN_DEBT);
  });
});
