#!/usr/bin/env node
// Git pre-push guard (installed via `core.hooksPath scripts/hooks`, see
// scripts/setup-git-hooks.mjs). Blocks the push if a new migration in
// supabase/migrations/ shares its 14-digit timestamp prefix with a migration
// already committed on origin/main — the collision documented in CLAUDE.md
// "Conventions" (breaks `supabase db push` / `db reset`).
//
// Caveat: bypassable with `git push --no-verify`, and can only see what the
// last `git fetch` knows about origin/main. Blocking CI (Prod-ready 9/7 task
// 02, the `lint-and-test` required check) is the real backstop.
import { execSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { findTimestampCollisions } from './lib/migration-guard.mjs';

function repoRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

function localMigrations(root) {
  const dir = join(root, 'supabase', 'migrations');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sql'));
}

function remoteMigrations() {
  try {
    const out = execSync('git ls-tree -r --name-only origin/main -- supabase/migrations', {
      encoding: 'utf8',
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((p) => p.split('/').pop());
  } catch {
    return null; // origin/main not known locally yet
  }
}

function main() {
  const root = repoRoot();
  const local = localMigrations(root);
  const remote = remoteMigrations();

  if (remote === null) {
    console.warn(
      '[pre-push] Could not read origin/main:supabase/migrations (try `git fetch origin main`) — skipping collision check.'
    );
    return 0;
  }

  const collisions = findTimestampCollisions(local, remote);
  if (collisions.length === 0) return 0;

  console.error('\n✖ Migration timestamp collision — push blocked.\n');
  for (const c of collisions) {
    console.error(`  ${c.local}`);
    console.error(`    shares its timestamp with ${c.remote} (already on origin/main)\n`);
  }
  console.error(
    'Pick a unique timestamp: check `git ls-files supabase/migrations | grep <YYYYMMDD>` against origin/main,\n' +
      'then rename the file.\n\n' +
      'Bypass (not recommended): git push --no-verify — blocking CI is the real backstop either way.\n'
  );
  return 1;
}

process.exit(main());
