/**
 * Phantom-reference guard (Prod-ready 9/7 task 01, ClickUp 86ey7q6vf).
 *
 * A prior session recorded a "flagship doc" in CLAUDE.md that was never
 * committed (`engineering-review-2026-07.md`, later found uncommitted in a
 * sibling worktree) — the reference survived two rounds of confusion. This
 * guard makes that class structurally impossible for CLAUDE.md: every
 * backticked or markdown-linked repo path in it must resolve to a file
 * tracked by git. With branch protection on `main` requiring CI, a phantom
 * path now blocks the merge.
 *
 * What counts as a checkable reference (deliberately conservative — better a
 * few unchecked tokens than false failures):
 *  - a backticked token or a relative markdown-link target,
 *  - made of path characters only (no spaces, globs, placeholders, URLs),
 *  - that contains a `/` OR ends in a known source/doc extension.
 * Resolution: exact tracked file, a tracked directory prefix, or a basename
 * match anywhere in the tree (for bare names like `kit.tsx`).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const CLAUDE_MD = path.join(ROOT, 'CLAUDE.md');

const FILE_EXT = /\.(md|ts|tsx|js|mjs|cjs|json|sql|toml|yml|yaml)$/;
// Path characters only — anything with spaces, <placeholders>, globs, (),
// @, : or leading / (route paths) is not a repo-file claim.
const PATH_SHAPE = /^[\w][\w./-]*$/;

function extractCandidates(markdown: string): string[] {
  const tokens = new Set<string>();
  for (const [, tok] of markdown.matchAll(/`([^`\n]+)`/g)) tokens.add(tok);
  // Relative markdown-link targets, e.g. [text](docs/changelog.md)
  for (const [, target] of markdown.matchAll(/\]\((?!https?:\/\/)([^)#\s]+)\)/g)) {
    tokens.add(target);
  }
  return [...tokens].filter((tok) => {
    const bare = tok.replace(/\/$/, '');
    if (!PATH_SHAPE.test(bare)) return false;
    if (/^origin\//.test(bare)) return false; // git ref, not a repo path
    return bare.includes('/') || FILE_EXT.test(bare);
  });
}

describe('CLAUDE.md file references', () => {
  it('every referenced repo path exists in git (no phantom docs)', () => {
    const tracked = execSync('git ls-files', { cwd: ROOT, maxBuffer: 16 * 1024 * 1024 })
      .toString()
      .split('\n')
      .filter(Boolean);
    const trackedSet = new Set(tracked);
    const basenames = new Set(tracked.map((f) => f.split('/').pop()));

    const missing = extractCandidates(readFileSync(CLAUDE_MD, 'utf8')).filter((tok) => {
      const bare = tok.replace(/\/$/, '');
      if (trackedSet.has(bare)) return false; // exact tracked file
      if (trackedSet.has(`${bare}.ts`) || trackedSet.has(`${bare}.tsx`)) return false; // extensionless TS module
      if (tracked.some((f) => f.startsWith(`${bare}/`))) return false; // directory
      if (!bare.includes('/') && basenames.has(bare)) return false; // bare filename
      return true;
    });

    expect(
      missing,
      `CLAUDE.md references paths that are not tracked by git: ${missing.join(', ')}. ` +
        'Either the path is wrong/stale (fix the reference) or the file was never ' +
        'committed (commit it, or move the claim to docs/changelog.md as history). ' +
        'Verify claims with `git ls-files <path>` before writing them down.',
    ).toEqual([]);
  });
});
