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
  console.log('[setup-git-hooks] core.hooksPath -> scripts/hooks (pre-push migration-collision guard active)');
} catch (err) {
  console.warn('[setup-git-hooks] could not set core.hooksPath:', err.message);
}
