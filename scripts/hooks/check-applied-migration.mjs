#!/usr/bin/env node
// Claude Code PreToolUse hook (wired in .claude/settings.json). Blocks Edit/Write
// on any supabase/migrations/*.sql file that already exists on origin/main —
// mechanically enforcing CLAUDE.md "Conventions": "never edit an applied
// migration — write a new one".
//
// Caveat: locally bypassable (edit the file outside Claude Code, or disable the
// hook), and only sees what the last `git fetch` knows about origin/main.
// Blocking CI (Prod-ready 9/7 task 02) is the real backstop.
import { execSync } from 'node:child_process';
import { relative, resolve } from 'node:path';
import { isMigrationPath } from './lib/migration-guard.mjs';

function readStdin() {
  return new Promise((resolvePromise) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolvePromise(''));
  });
}

function repoRoot() {
  return execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
}

function existsOnOriginMain(relativePosixPath) {
  try {
    execSync(`git cat-file -e origin/main:${relativePosixPath}`, {
      stdio: ['ignore', 'ignore', 'ignore'],
    });
    return true;
  } catch {
    return false; // not on origin/main (or origin/main unknown) — nothing to block
  }
}

function deny(relativePath) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason:
          `${relativePath} is already on origin/main. Migrations are append-only ` +
          '(CLAUDE.md "never edit an applied migration") — write a new migration instead.',
      },
    })
  );
}

async function main() {
  const raw = await readStdin();
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // no/invalid stdin — nothing to check
  }

  const toolName = input.tool_name;
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || (toolName !== 'Write' && toolName !== 'Edit')) return;

  let root;
  try {
    root = repoRoot();
  } catch {
    return; // not inside a git repo
  }

  const rel = relative(root, resolve(filePath)).split('\\').join('/');
  if (!isMigrationPath(rel)) return;
  if (!existsOnOriginMain(rel)) return;

  deny(rel);
}

main();
