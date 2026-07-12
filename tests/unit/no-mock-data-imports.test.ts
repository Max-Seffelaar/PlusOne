/**
 * No-mock-data-import guard (FE-5 CI guardrail half).
 *
 * `src/lib/po/data.ts` held the PLUSONE mobile-prototype MOCK fixtures — fine
 * for types/tests, never for a shipped render path (CLAUDE.md "Front-end
 * discipline"). The last fixture (the mock venue list) was removed 2026-07-12
 * and the module deleted with it; this guard keeps it from coming back: it
 * scans every `.ts`/`.tsx` under the shipped `po` components + features
 * directories (the whole component tree, not just screens/ — the app shell
 * itself was the last offender) and fails if any of them import the `data`
 * MODULE specifier — a real regression class, since prototype fixture arrays
 * look plausible enough to slot in during a rushed screen edit.
 *
 * Type-only imports from the separate `src/lib/po/types.ts` module (the actual
 * domain types, used throughout screens/features) are unaffected — this only
 * matches the `data` module specifier, not `types`.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = [
  path.join(ROOT, 'src', 'components', 'po'),
  path.join(ROOT, 'src', 'features', 'po'),
];

// Matches `@/lib/po/data`, a relative `lib/po/data`, or either with an
// explicit `.ts`/`.tsx` extension — but NOT `@/lib/po/data-something-else` or
// `@/lib/po/types` (word-boundary anchored on the module basename).
const DATA_IMPORT = /from\s+['"](?:@\/|\.{1,2}\/)*lib\/po\/data(?:\.tsx?)?['"]/;
const REQUIRE_DATA_IMPORT = /require\(\s*['"](?:@\/|\.{1,2}\/)*lib\/po\/data(?:\.tsx?)?['"]\s*\)/;

/** Every .ts/.tsx file under `dir`, recursively, excluding test files. */
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

const FILES = SCAN_DIRS.flatMap((dir) => sourceFiles(dir));

describe('no mock-data imports in shipped po screens/features', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it('never imports src/lib/po/data.ts from a shipped screen or po feature module', () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      return DATA_IMPORT.test(src) || REQUIRE_DATA_IMPORT.test(src);
    }).map((f) => path.relative(ROOT, f));

    expect(
      offenders,
      `These files import the deleted mock-data module (src/lib/po/data.ts) from a ` +
        `shipped render path: ${offenders.join(', ')}. The prototype fixtures are gone ` +
        `— read live data through src/features/po instead (see CLAUDE.md "Front-end ` +
        'discipline"). Type-only imports from src/lib/po/types.ts are unaffected.',
    ).toEqual([]);
  });
});
