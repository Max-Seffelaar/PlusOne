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

// A VALUE import of the SDK — `import * as Sentry`, `import Sentry`, or
// `import { x }` — but NOT `import type … from '@sentry/nextjs'`.
const VALUE_IMPORT = /import\s+(?!type\s)[\s\S]*?from\s+['"]@sentry\/nextjs['"]/;

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
