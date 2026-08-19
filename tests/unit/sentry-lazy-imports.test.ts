/**
 * Lazy-Sentry guard (#B2, task 86ey9e8z5).
 *
 * The ~131 kB gz browser SDK is deferred off every route's First Load JS: client
 * code reaches Sentry ONLY through the lazy facade `@/lib/observability/sentry-client`
 * (which `import type`s the SDK, so it pulls nothing into a first-load graph).
 * A stray static `import ... from '@sentry/nextjs'` in a client module would
 * re-eagerize the whole SDK and silently undo the win — this scan fails if one
 * appears outside the small allowlist.
 *
 * `import type { … } from '@sentry/nextjs'` is fine (erased at build) and not
 * flagged.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'src');

// Files allowed to VALUE-import '@sentry/nextjs':
//  - instrumentation.ts     → server-only (node/edge register), never client-bundled
//  - sentry.client.init.ts  → the init module, itself only reached via lazy import()
//  - sentry-test route      → an isolated diagnostic page that intentionally loads Sentry
const ALLOWLIST = new Set(
  [
    'src/instrumentation.ts',
    'src/sentry.client.init.ts',
    'src/app/sentry-test/SentryTestButtons.tsx',
  ].map((p) => path.normalize(p)),
);

// A VALUE import of the SDK — `import * as Sentry`, `import Sentry`,
// `import { x } from …` or the bare side-effect `import '@sentry/nextjs'` —
// but NOT `import type … from '@sentry/nextjs'`, and NOT a dynamic
// `import('@sentry/nextjs')` in value or type position.
//
// ONE STATEMENT AT A TIME. The previous version was
// `/import\s+(?!type\s)[\s\S]*?from\s+['"]@sentry\/nextjs['"]/`, whose `[\s\S]*?`
// spanned the whole file: the negative lookahead therefore only ever inspected
// the FIRST import statement, and any earlier import at all (`import
// 'server-only'`, `import { z } from 'zod'`) started a match that ran on to a
// later Sentry `from` clause. A perfectly legal `import type … from
// '@sentry/nextjs'` was flagged in every file that had any import above it —
// contradicting this rule's own documented contract. Pinned by
// `describe('VALUE_IMPORT (the rule itself)')` below.
//
// The clause between `import` and `from` may span lines (prettier wraps long
// named imports) but may never cross a `;`, a quote, or another `import`
// keyword — which is what confines a match to a single statement. `^` with the
// `m` flag anchors the start to a statement, so `await import('…')` and
// `typeof import('…')` mid-line can never start one.
const IMPORT_CLAUSE = String.raw`(?:(?!\bimport\b)[^;'"])*?`;
const SENTRY_MODULE = String.raw`['"]@sentry\/nextjs['"]`;
const VALUE_IMPORT = new RegExp(
  // `import <clause> from '@sentry/nextjs'`, excluding `import type …`
  String.raw`^[ \t]*import\s+(?!type\s)${IMPORT_CLAUSE}from\s*${SENTRY_MODULE}` +
    '|' +
    // the bare side-effect form `import '@sentry/nextjs'` — no `from` clause,
    // invisible to the old rule, and it eagerizes the SDK just the same.
    String.raw`^[ \t]*import\s*${SENTRY_MODULE}`,
  'm',
);

/** Strip comments so prose like `import type`s the SDK` in a doc block can't
 *  masquerade as a real import statement. */
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

describe('Sentry browser SDK stays lazy (no static @sentry/nextjs imports)', () => {
  it('finds source files to scan (sanity — the walk is not empty)', () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  it('never statically value-imports @sentry/nextjs outside the allowlist', () => {
    const offenders = FILES.filter((f) => {
      const rel = path.normalize(path.relative(ROOT, f));
      if (ALLOWLIST.has(rel)) return false;
      return VALUE_IMPORT.test(stripComments(readFileSync(f, 'utf8')));
    }).map((f) => path.relative(ROOT, f));

    expect(
      offenders,
      `These files statically value-import '@sentry/nextjs', which re-eagerizes the ` +
        `~131 kB gz browser SDK into their First Load JS (task 86ey9e8z5). Route telemetry ` +
        `through the lazy facade '@/lib/observability/sentry-client' instead, or use ` +
        `\`import type\`. Allowed: ${[...ALLOWLIST].join(', ')}.`,
    ).toEqual([]);
  });
});

// The rule's own contract, pinned in BOTH directions. A guard that is wrong
// about what it flags is worse than no guard: it teaches the next author to
// route around it (which is exactly what `src/lib/observability/sentry-server.ts`
// had to do). These cases are the evidence that the fix does not WEAKEN the
// rule — every real value import is still caught.
describe('VALUE_IMPORT (the rule itself)', () => {
  const check = (src: string): boolean => VALUE_IMPORT.test(stripComments(src));

  // --- must NOT flag ------------------------------------------------------
  it.each([
    ['a type-only import alone', `import type { X } from '@sentry/nextjs';\n`],
    [
      'a type-only import after a side-effect import (the regression)',
      `import 'server-only';\nimport type { X } from '@sentry/nextjs';\n`,
    ],
    [
      'a type-only import after an unrelated value import (the regression)',
      `import { z } from 'zod';\nimport type { X } from '@sentry/nextjs';\n`,
    ],
    [
      'a type-only namespace import after other imports',
      `import 'server-only';\nimport type * as NS from '@sentry/nextjs';\n`,
    ],
    [
      'a multi-line type-only import',
      `import { z } from 'zod';\nimport type {\n  Scope,\n  User,\n} from '@sentry/nextjs';\n`,
    ],
    [
      'typeof import(...) in type position (sentry-server.ts)',
      `import 'server-only';\ntype S = typeof import('@sentry/nextjs');\n`,
    ],
    [
      'an awaited dynamic import in a function body',
      `import 'server-only';\nasync function f() {\n  const S = await import('@sentry/nextjs');\n}\n`,
    ],
    [
      'a dynamic import starting its own line',
      `import { z } from 'zod';\nvoid\n  import('@sentry/nextjs');\n`,
    ],
    [
      'an unrelated module whose name merely contains the specifier in a string',
      `import { z } from 'zod';\nconst name = '@sentry/nextjs';\n`,
    ],
  ])('does not flag %s', (_label, src) => {
    expect(check(src)).toBe(false);
  });

  // --- must flag ----------------------------------------------------------
  it.each([
    ['a namespace value import', `import * as Sentry from '@sentry/nextjs';\n`],
    ['a default value import', `import Sentry from '@sentry/nextjs';\n`],
    ['a named value import', `import { captureMessage } from '@sentry/nextjs';\n`],
    [
      'a named value import after other imports',
      `import { z } from 'zod';\nimport { captureMessage } from '@sentry/nextjs';\n`,
    ],
    [
      'a namespace value import after a side-effect import',
      `import 'server-only';\nimport * as Sentry from '@sentry/nextjs';\n`,
    ],
    [
      'a multi-line named value import (prettier wrap)',
      `import { z } from 'zod';\nimport {\n  captureMessage,\n  setUser,\n} from '@sentry/nextjs';\n`,
    ],
    [
      'a value import written with double quotes',
      `import { z } from 'zod';\nimport * as Sentry from "@sentry/nextjs";\n`,
    ],
    [
      'an inline type specifier mixed into a value import',
      `import 'server-only';\nimport { type Scope, captureMessage } from '@sentry/nextjs';\n`,
    ],
    [
      'the bare side-effect import (missed entirely by the old rule)',
      `import { z } from 'zod';\nimport '@sentry/nextjs';\n`,
    ],
  ])('flags %s', (_label, src) => {
    expect(check(src)).toBe(true);
  });

  it('still flags every file on the allowlist — the allowlist is not dead code', () => {
    for (const rel of ALLOWLIST) {
      const src = readFileSync(path.join(ROOT, rel), 'utf8');
      expect(VALUE_IMPORT.test(stripComments(src)), `${rel} should match VALUE_IMPORT`).toBe(true);
    }
  });
});
