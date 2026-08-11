/**
 * RPC-name-has-a-migration guard (86ey9e9wv/A1, fresh-session /code-review).
 *
 * A `client.rpc('name', …)` call resolves the function through PostgREST's
 * schema cache, not `tsc` — a typo'd name, a renamed function, or (the case
 * that actually bit this repo) a new RPC whose migration was never pushed to
 * prod all compile clean and only fail at runtime as `PGRST202 Could not find
 * the function`. CLAUDE.md's expand–contract flow assumes migration-BEFORE-
 * code; a PR that adds both in one commit and merges before `supabase db push`
 * runs inverts that for the window between deploy and push. See the comment
 * on `fetchEventHeadcounts` (src/features/po/queries.ts) for the prior
 * incident this class of bug caused.
 *
 * This is a cheap, mechanical net, not a full PostgREST-cache simulation: it
 * scans every shipped `.ts`/`.tsx` file for a `.rpc('literal-name', …)` call
 * and every `supabase/migrations/*.sql` file for a `create [or replace]
 * function public.<name>(` definition, then asserts every called name has
 * been defined SOMEWHERE in the migration history. It does not verify
 * argument signatures, that the migration has actually been pushed to prod,
 * or that a since-dropped function wasn't silently re-referenced — it only
 * catches "this code calls an RPC no migration in this repo ever created",
 * which is exactly the silent-prod-break shape from the incident above.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SRC_DIR = path.join(ROOT, 'src');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

// `.rpc('name', …)` / `.rpc("name", …)` — literal string first argument only;
// a dynamic/variable RPC name is out of scope for a static scan like this.
const RPC_CALL = /\.rpc\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
// `create function public.name(` / `create or replace function public.name(`.
const FUNCTION_DEF = /create\s+(?:or\s+replace\s+)?function\s+public\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/gi;

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

function allMatches(text: string, re: RegExp): string[] {
  return [...text.matchAll(re)].map((m) => m[1]);
}

const SRC_FILES = sourceFiles(SRC_DIR);
const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => path.join(MIGRATIONS_DIR, f));

describe('every client.rpc(...) name resolves to a migration (86ey9e9wv/A1)', () => {
  it('finds source and migration files to scan (sanity — the walk is not empty)', () => {
    expect(SRC_FILES.length).toBeGreaterThan(10);
    expect(MIGRATION_FILES.length).toBeGreaterThan(10);
  });

  it('every .rpc() call site names a function some migration actually creates', () => {
    const definedNames = new Set(
      MIGRATION_FILES.flatMap((f) => allMatches(readFileSync(f, 'utf8'), FUNCTION_DEF)),
    );

    const missing = new Map<string, string[]>();
    for (const file of SRC_FILES) {
      const rel = path.relative(ROOT, file);
      for (const name of allMatches(readFileSync(file, 'utf8'), RPC_CALL)) {
        if (definedNames.has(name)) continue;
        missing.set(name, [...(missing.get(name) ?? []), rel]);
      }
    }

    const report = [...missing.entries()]
      .map(([name, files]) => `${name} (called from ${files.join(', ')})`)
      .join('; ');

    expect(
      [...missing.keys()],
      `These RPC names are called from src/ but no migration in supabase/migrations/ ` +
        `defines them — either a typo, a renamed function, or code merged ahead of its ` +
        `migration: ${report}`,
    ).toEqual([]);
  });
});
