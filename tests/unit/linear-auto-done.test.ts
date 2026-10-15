/**
 * Decision contract for the merge → Linear auto-Done step (PLU-125).
 *
 * The gate Max decided on 2026-10-15: `Test: auto` without a migration goes to
 * Done at merge; with a migration it waits for the prod push; `Test: Max` and a
 * missing Test line both wait for Max. A wrong answer here either skips the test
 * gate or leaves Max clicking Done by hand, so each branch is pinned.
 */
import { describe, expect, it } from 'vitest';
import { hasMigration, issueKeys, planAutoDone, testMode } from '../../scripts/lib/linear-auto-done.mjs';

describe('issueKeys', () => {
  it('reads keys from the title and from Linear: lines only', () => {
    const body = 'Fixes the thing.\nLinear: PLU-12, plu-13\nRelated to PLU-99 in passing.';
    expect(issueKeys('feat(x): thing (PLU-125)', body)).toEqual(['PLU-125', 'PLU-12', 'PLU-13']);
  });

  it('ignores keys mentioned in free body text', () => {
    expect(issueKeys('chore: no key', 'See PLU-7 for context.')).toEqual([]);
  });

  it('dedupes a key named in both places', () => {
    expect(issueKeys('fix (PLU-5)', 'Linear: PLU-5')).toEqual(['PLU-5']);
  });
});

describe('testMode', () => {
  it('reads auto and max case-insensitively, also in bold', () => {
    expect(testMode('Test: auto')).toBe('auto');
    expect(testMode('**Test:** Max')).toBe('max');
    expect(testMode('  test: MAX — screens 3, 4')).toBe('max');
  });

  it('reports a missing line', () => {
    expect(testMode('No test line here')).toBe('missing');
  });
});

describe('hasMigration', () => {
  it('detects files under supabase/migrations/', () => {
    expect(hasMigration(['src/a.ts', 'supabase/migrations/20261015_x.sql'])).toBe(true);
    expect(hasMigration(['supabase/tests/database/x.test.sql'])).toBe(false);
  });
});

describe('planAutoDone', () => {
  const base = { title: 'feat: x (PLU-1)', prNumber: 42 };

  it('Test: auto without a migration → done', () => {
    const p = planAutoDone({ ...base, body: 'Test: auto', files: ['src/a.ts'] });
    expect(p.action).toBe('done');
    expect(p.keys).toEqual(['PLU-1']);
    expect(p.comment).toContain('#42');
  });

  it('Test: auto with a migration → wait for the prod push', () => {
    const p = planAutoDone({
      ...base,
      body: 'Test: auto',
      files: ['supabase/migrations/20261015120000_x.sql'],
    });
    expect(p.action).toBe('wait-prod');
  });

  it('Test: Max → assign to Max, never done', () => {
    const p = planAutoDone({ ...base, body: 'Test: Max', files: ['src/a.ts'] });
    expect(p.action).toBe('assign-max');
  });

  it('a missing Test line keeps the gate (assign to Max)', () => {
    const p = planAutoDone({ ...base, body: '', files: ['src/a.ts'] });
    expect(p.action).toBe('assign-max');
    expect(p.comment).toContain('veilige standaard');
  });

  it('no key → nothing to do', () => {
    const p = planAutoDone({ title: 'chore: deps', body: 'Test: auto', files: [], prNumber: 1 });
    expect(p.action).toBe('none');
  });

  it('a null PR body (GitHub sends null when empty) is treated as missing', () => {
    const p = planAutoDone({ ...base, body: null as unknown as string, files: [] });
    expect(p.action).toBe('assign-max');
  });
});
