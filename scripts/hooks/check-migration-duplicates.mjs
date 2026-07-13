#!/usr/bin/env node
// Fast, self-contained CI guard: fails if two files in supabase/migrations/
// share a 14-digit timestamp prefix. Complements check-migration-collisions.mjs
// (the pre-push hook, which only compares a branch against origin/main at push
// time): two branches can each pick a free timestamp and only collide once
// BOTH land on main, which a per-branch check can never see (86ey9e84m /
// 86ey9e851, 13/7 — CI on main did fail within minutes, but nobody was
// watching post-merge push runs). Runs first in the workflow, before
// `pnpm install`, so a collision fails in seconds, not after the full suite.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findDuplicateTimestamps } from './lib/migration-guard.mjs';

function repoRoot() {
  return join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
}

function main() {
  const dir = join(repoRoot(), 'supabase', 'migrations');
  if (!existsSync(dir)) return 0;

  const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
  const duplicates = findDuplicateTimestamps(files);
  if (duplicates.length === 0) return 0;

  console.error('\n✖ Migration timestamp collision — supabase/migrations/ has duplicates.\n');
  for (const group of duplicates) {
    console.error(`  ${group.join('\n  ')}`);
    console.error('');
  }
  console.error(
    'Two migrations share the same 14-digit prefix — this breaks `supabase db push`/`db reset`\n' +
      '(duplicate key on schema_migrations_pkey). Rename the later-merged file to a unique\n' +
      'timestamp per CLAUDE.md "Conventions".\n'
  );
  return 1;
}

process.exit(main());
