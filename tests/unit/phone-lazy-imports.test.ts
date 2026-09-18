/**
 * Lazy phone-field guard (#B4, task 86ey9e8z5).
 *
 * `react-phone-number-input` (all country-flag SVGs + libphonenumber metadata,
 * ~102 kB gz) is code-split behind `@/components/po/phone-lazy`. Every consumer
 * imports the picker / input / validators from there, so the heavy deps stay in
 * their own async chunk and out of the First Load of the public guest pages
 * (`/e`, `/r`, `/consent`) and `/app`. A stray static `react-phone-number-input`
 * import in a screen would drag them back into first paint — this scan fails if
 * one appears outside the two files that are, by design, only ever reached
 * through a dynamic `import()`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// Allowed to import 'react-phone-number-input' (any subpath):
//  - phone-lazy.tsx    → the code-split boundary; its runtime refs are dynamic import()s
//  - country-select.tsx→ the picker leaf, itself loaded ONLY via phone-lazy's dynamic()
const ALLOWLIST = new Set(
  ['src/components/po/phone-lazy.tsx', 'src/components/po/country-select.tsx'].map((p) =>
    path.normalize(p),
  ),
);

// A VALUE import of the library or any subpath (`/input`, `/flags`, `/locale/*`),
// but NOT `import type … from 'react-phone-number-input'`.
const VALUE_IMPORT =
  /import\s+(?!type\s)[\s\S]*?from\s+['"]react-phone-number-input(?:\/[^'"]*)?['"]/;

// The ONE narrow exception (z8uq9m0hw2): the shared country list reads the
// package's English NAME table, which is ~6 kB of country names and nothing
// else (no flag SVGs, no libphonenumber metadata, i.e. none of what this guard
// keeps out of First Load). That module may import exactly this subpath; any
// other static or dynamic import of the package there still fails below.
const NAME_TABLE_MODULE = path.normalize('src/lib/countries.ts');
const NAME_TABLE = 'react-phone-number-input/locale/en.json';

/** Every package specifier a file pulls in: a value import, a re-export, or a
 *  dynamic import(). */
function packageSpecifiers(src: string): string[] {
  return [
    ...src.matchAll(
      /(?:import|export)\s+(?!type\s)[^;]*?from\s+['"](react-phone-number-input(?:\/[^'"]*)?)['"]|import\(\s*['"](react-phone-number-input(?:\/[^'"]*)?)['"]\s*\)/g,
    ),
  ]
    .map((m) => m[1] ?? m[2])
    .filter((spec): spec is string => Boolean(spec));
}

/** Strip comments so prose in a doc block can't masquerade as a real import. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const FILES = sourceFiles(SRC);

describe('phone-number-input stays lazy (no static react-phone-number-input imports)', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('never statically imports react-phone-number-input outside the lazy boundary', () => {
    const offenders = FILES.filter((f) => {
      const rel = path.normalize(path.relative(ROOT, f));
      if (ALLOWLIST.has(rel)) return false;
      if (rel === NAME_TABLE_MODULE) return false; // pinned by its own test below
      return VALUE_IMPORT.test(stripComments(readFileSync(f, 'utf8')));
    }).map((f) => path.relative(ROOT, f));

    expect(
      offenders,
      `These files statically import 'react-phone-number-input', pulling the flags + ` +
        `libphonenumber metadata (~102 kB gz) into their First Load JS (task 86ey9e8z5). ` +
        `Import CountrySelect / PhoneInput / isPhoneValid / phoneCountryOf / ` +
        `useStoredPhoneCountry from '@/components/po/phone-lazy' instead. ` +
        `Allowed: ${[...ALLOWLIST].join(', ')}.`,
    ).toEqual([]);
  });

  it('lets the shared country list import the name table and nothing else from the package', () => {
    const src = stripComments(readFileSync(path.join(ROOT, NAME_TABLE_MODULE), 'utf8'));
    const specs = packageSpecifiers(src);
    // It must actually be the name table (so this exception can't go stale
    // silently) and ONLY the name table: flags or metadata here would put them
    // in the /app First Load via the venue settings screen.
    expect(specs, `${NAME_TABLE_MODULE} should import '${NAME_TABLE}'`).toContain(NAME_TABLE);
    expect(
      specs.filter((s) => s !== NAME_TABLE),
      `${NAME_TABLE_MODULE} may import only '${NAME_TABLE}' from react-phone-number-input. ` +
        `Anything else from the package (flags, /max, /input) must stay behind ` +
        `'@/components/po/phone-lazy' (task 86ey9e8z5).`,
    ).toEqual([]);
  });
});
