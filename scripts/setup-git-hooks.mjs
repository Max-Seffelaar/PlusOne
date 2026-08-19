#!/usr/bin/env node
// Points git at scripts/hooks/ so the pre-push migration-collision guard
// (scripts/hooks/pre-push) runs without a manual install step. Run via
// package.json "postinstall" — idempotent, safe to re-run on every `pnpm install`.
import { execSync } from 'node:child_process';

try {
  execSync('git rev-parse --is-inside-work-tree', { stdio: 'ignore' });
} catch {
  process.exit(0); // not a git checkout — nothing to do
}

try {
  execSync('git config core.hooksPath scripts/hooks', { stdio: 'ignore' });
} catch (err) {
  console.warn('[setup-git-hooks] could not set core.hooksPath:', err.message);
  process.exit(0);
}

// Do not claim the guard is active without checking. It was inert for months:
// scripts/hooks/pre-push was committed as mode 100644, so git skipped it on
// every push and said so only in an easily-missed `hint:` line -- while this
// script printed "guard active" on every install. Announcing a guard you have
// not verified is worse than printing nothing.
let mode = '';
try {
  mode = execSync('git ls-files --stage -- scripts/hooks/pre-push', { encoding: 'utf8' })
    .trim()
    .split(/\s+/)[0];
} catch {
  // fall through to the warning below
}

if (mode === '100755') {
  console.log('[setup-git-hooks] core.hooksPath -> scripts/hooks (pre-push migration-collision guard active)');
} else {
  console.warn(
    `[setup-git-hooks] core.hooksPath -> scripts/hooks, but scripts/hooks/pre-push is mode ${mode || '(untracked)'}, not 100755.\n` +
      '[setup-git-hooks] git will SKIP it: the migration-collision guard is NOT running.\n' +
      '[setup-git-hooks] Fix with: git update-index --chmod=+x scripts/hooks/pre-push',
  );
}
