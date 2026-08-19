/**
 * The migration-collision guard is only as good as its delivery mechanism.
 *
 * `scripts/hooks/lib/migration-guard.mjs` has thorough unit coverage
 * (migration-guard.test.ts), and that file states outright that it tests the
 * pure logic "without touching git or fs". Nothing tested whether the hook that
 * calls it ever runs — and it did not. `scripts/hooks/pre-push` was committed as
 * mode 100644, so git skipped it on every push for every contributor, emitting
 * only an easily-missed `hint:` line. Meanwhile `scripts/setup-git-hooks.mjs`
 * printed "pre-push migration-collision guard active" on every `pnpm install`.
 *
 * A perfectly tested function nobody calls is not a guard. This test asserts the
 * wiring instead of the logic: the mode recorded in git (not the working tree —
 * a local `chmod` would mask a regression for the person who ran it, and the
 * committed mode is what every other clone gets).
 *
 * Found while merging the 2026-08 performance sweep, where migration-timestamp
 * collisions had to be checked by hand precisely because nothing else did.
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

/** Git's recorded mode for a path, e.g. '100755'. Reads the index, not the disk. */
function committedMode(path: string): string {
  const out = execFileSync('git', ['ls-files', '--stage', '--', path], {
    encoding: 'utf8',
  }).trim();
  expect(out, `${path} is not tracked by git`).not.toBe('');
  return out.split(/\s+/)[0];
}

describe('git hooks are executable as committed', () => {
  it('scripts/hooks/pre-push is mode 100755, so git actually runs it', () => {
    expect(committedMode('scripts/hooks/pre-push')).toBe('100755');
  });

  it('core.hooksPath points at scripts/hooks, so the hook is the one git looks for', () => {
    // setup-git-hooks.mjs sets this from package.json postinstall. If it is
    // unset the hook is inert no matter what its mode says.
    const configured = execFileSync('git', ['config', '--get', 'core.hooksPath'], {
      encoding: 'utf8',
    }).trim();
    expect(configured).toBe('scripts/hooks');
  });
});
