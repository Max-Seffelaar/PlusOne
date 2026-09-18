/**
 * Global-JSX-namespace guard (86eyd39gn).
 *
 * `JSX.Element` used to resolve through the *global* `JSX` namespace. @types/react
 * 18.3 marks that global `@deprecated` ("Use `React.JSX` instead of the global `JSX`
 * namespace") and @types/react 19 removes the `declare global` block outright, so a
 * bare annotation fails there with `TS2503: Cannot find namespace 'JSX'`. 269 such
 * annotations across 107 files were migrated to an explicit `JSX` import from 'react',
 * which compiles under both 18 and 19 — that sweep is why the 18 → 19 types bump
 * (z8uq9m0h2h) cost three errors in two files instead of 272.
 *
 * @types/react is on 19 since z8uq9m0h2h, so tsc now DOES reject a bare `JSX.Element`
 * (TS2503) — this guard is no longer the only thing standing between us and the trap.
 * It stays because it still earns its place: it names the offending files and the exact
 * fix instead of leaving a TS2503 per annotation, it runs in the unit suite (so a
 * regression surfaces without a full `tsc` pass), and it keeps holding if the types are
 * ever pinned back to 18, where the global is merely `@deprecated` and tsc goes quiet
 * again. Rule unchanged: a file that mentions `JSX.` must also import the namespace
 * from 'react'.
 *
 * Alternatives that also satisfy the guard, since both keep working under 19:
 * `React.JSX.Element` with React in scope, or dropping the annotation and letting
 * TypeScript infer it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = [
  path.join(ROOT, 'src'),
  path.join(ROOT, 'tests'),
  path.join(ROOT, 'scripts'),
];

/** A bare `JSX.<Member>` reference — the global-namespace form. */
const BARE_JSX = /(?<!\.)\bJSX\.[A-Za-z]/;
/** `React.JSX.Element` (or any alias ending in a dot) — already namespace-qualified. */
const QUALIFIED_JSX = /\.JSX\.[A-Za-z]/;
/** `import … { … JSX … } from 'react'` / `import type { JSX } …`, single- or multi-line. */
const JSX_IMPORTED_FROM_REACT = /import\s+(?:type\s+)?\{[^}]*\bJSX\b[^}]*\}\s*from\s+['"]react['"]/;
/** `import * as React from 'react'` / `import React from 'react'` — enables React.JSX. */
const REACT_NAMESPACE_IN_SCOPE = /import\s+(?:\*\s+as\s+)?React(?:\s*,|\s+)[^;]*from\s+['"]react['"]|import\s+(?:\*\s+as\s+)?React\s+from\s+['"]react['"]/;

/**
 * This guard's own prose quotes the offending pattern, so it can't scan itself.
 * Hard-coded rather than derived from `__filename`/`import.meta.url` so it behaves
 * the same however vitest loads this module; rename the file and the self-scan
 * comes back, which the suite will tell you about immediately.
 */
const SELF = 'jsx-namespace-imported.test.ts';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name)) continue;
    if (entry.name === SELF) continue;
    out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((dir) => sourceFiles(dir));

describe('JSX namespace is imported, never taken from the deprecated global', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(100);
  });

  it('still guards a real population of JSX.Element annotations', () => {
    // If this drops to 0 the sweep was undone (or the annotations were dropped
    // wholesale) and the guard above would pass vacuously.
    const annotated = FILES.filter((f) => BARE_JSX.test(readFileSync(f, 'utf8')));
    expect(annotated.length).toBeGreaterThan(50);
  });

  it('never references JSX.* without importing the namespace from react', () => {
    const offenders = FILES.filter((f) => {
      const src = readFileSync(f, 'utf8');
      if (!BARE_JSX.test(src)) return false;
      if (JSX_IMPORTED_FROM_REACT.test(src)) return false;
      // `React.JSX.Element` with React in scope is fine; make sure the only JSX.
      // hits are the qualified ones before accepting it.
      if (REACT_NAMESPACE_IN_SCOPE.test(src) && QUALIFIED_JSX.test(src)) {
        const bareOnly = src.replace(/\.JSX\.[A-Za-z]/g, '.__qualified__');
        return BARE_JSX.test(bareOnly);
      }
      return true;
    }).map((f) => path.relative(ROOT, f));

    expect(
      offenders,
      `These files use the deprecated GLOBAL JSX namespace: ${offenders.join(', ')}. ` +
        `@types/react 19 removes it, so tsc rejects it outright ` +
        `(TS2503: Cannot find namespace 'JSX'). ` +
        `Add JSX to the file's react import — \`import type { JSX } from 'react';\` or ` +
        "`import { type JSX, … } from 'react';` — or drop the annotation and let " +
        'TypeScript infer the return type.',
    ).toEqual([]);
  });
});
