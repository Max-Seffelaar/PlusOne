/**
 * Prod-ready 9/7 task 03 (ClickUp 86ey7q6xq): two mechanical guards enforce
 * CLAUDE.md "Conventions" — unique migration timestamps + "never edit an
 * applied migration" — via scripts/hooks/lib/migration-guard.mjs (a git
 * pre-push hook + a Claude Code PreToolUse hook, see scripts/hooks/README.md
 * for the caveat that both are locally bypassable; blocking CI is the real
 * backstop). This tests the shared pure logic without touching git or fs.
 */
import { describe, expect, it } from 'vitest';
import { findTimestampCollisions, isMigrationPath, timestampOf } from '../../scripts/hooks/lib/migration-guard.mjs';

describe('timestampOf', () => {
  it('extracts the 14-digit prefix', () => {
    expect(timestampOf('20260708120000_venue_scope_denormalization.sql')).toBe('20260708120000');
  });

  it('returns null for a filename without a timestamp prefix', () => {
    expect(timestampOf('README.md')).toBeNull();
    expect(timestampOf('2026_not_a_timestamp.sql')).toBeNull();
  });
});

describe('findTimestampCollisions', () => {
  it('flags a new local migration sharing a timestamp with one already on origin/main', () => {
    const remote = ['20260708120000_venue_scope_denormalization.sql'];
    const local = [...remote, '20260708120000_fake_collision.sql'];

    const collisions = findTimestampCollisions(local, remote);

    expect(collisions).toEqual([
      { local: '20260708120000_fake_collision.sql', remote: '20260708120000_venue_scope_denormalization.sql' },
    ]);
  });

  it('does not flag a migration that is itself already on origin/main', () => {
    const remote = ['20260708120000_venue_scope_denormalization.sql'];
    const local = [...remote];

    expect(findTimestampCollisions(local, remote)).toEqual([]);
  });

  it('does not flag a new migration with a unique timestamp', () => {
    const remote = ['20260708120000_venue_scope_denormalization.sql'];
    const local = [...remote, '20260709090000_new_thing.sql'];

    expect(findTimestampCollisions(local, remote)).toEqual([]);
  });

  it('ignores files without a timestamp prefix on either side', () => {
    expect(findTimestampCollisions(['README.md'], ['README.md', '20260101000000_a.sql'])).toEqual([]);
  });
});

describe('isMigrationPath', () => {
  it('matches a repo-relative migration file, forward or back slashes', () => {
    expect(isMigrationPath('supabase/migrations/20260708120000_foo.sql')).toBe(true);
    expect(isMigrationPath('supabase\\migrations\\20260708120000_foo.sql')).toBe(true);
  });

  it('rejects non-migration paths', () => {
    expect(isMigrationPath('CLAUDE.md')).toBe(false);
    expect(isMigrationPath('supabase/seed.sql')).toBe(false);
    expect(isMigrationPath('supabase/migrations/subdir/20260708120000_foo.sql')).toBe(false);
  });
});
