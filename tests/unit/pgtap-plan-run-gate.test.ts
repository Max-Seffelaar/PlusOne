/**
 * pgTAP plan/run gate (86eykjgrb).
 *
 * `supabase test db` shells out to pg_prove, which is stricter than it looks:
 * it fails on a `not ok` line, and it passes ON_ERROR_STOP=1 to psql, so a file
 * that dies mid-run truncates its TAP stream and TAP::Harness reports a bad plan.
 * One case slips through anyway. When a file wraps assertions in
 * `savepoint` / `rollback to savepoint`, the rollback reverts pgTAP's own counter
 * (it lives in the temp table __tcache__) while the test numbers it prints keep
 * climbing (those come from __tresults___numb_seq, a non-transactional sequence).
 * The TAP stream stays well-formed and complete, so the harness correctly says
 * PASS — and pgTAP's contradicting self-check is emitted only as a TAP *comment*:
 *
 *     # Looks like you planned 15 tests but ran 2
 *
 * That comment was sitting in the suite output for two files. It is the only
 * signal that a file's plan and its assertions have drifted, so scripts/db-test.mjs
 * turns it into a build failure. The fixtures below are real pg_prove output
 * captured from this repo's suite, not hand-written approximations.
 */
import { describe, expect, it } from 'vitest';

import { findGateFailures } from '../../scripts/lib/pgtap-gate.mjs';

// Real output: tiers.vat.test.sql before the fix. Note `Result: PASS`.
const MISMATCH_BUT_PASSING = `
supabase/tests/database/tables.test.sql ........................ ok
supabase/tests/database/tiers.vat.test.sql .....................
# Looks like you planned 15 tests but ran 2
ok
All tests successful.
Files=56, Tests=1092,  4 wallclock secs
Result: PASS
`;

// Real output: the same suite after the fix.
const CLEAN = `
supabase/tests/database/tables.test.sql ........................ ok
supabase/tests/database/tiers.vat.test.sql ..................... ok
supabase/tests/database/venue_id_rls_integrity.test.sql ........ ok
All tests successful.
Files=56, Tests=1092,  4 wallclock secs
Result: PASS
`;

// Real output: a file that dies mid-run. pg_prove already fails this one; the
// gate must still flag it rather than rely solely on the exit code.
const TRUNCATED = `
Dubious, test returned 3 (wstat 768, 0x300)
Failed 2/4 subtests
  Parse errors: Bad plan.  You planned 4 tests but ran 2.
Result: FAIL
`;

describe('findGateFailures', () => {
  it('flags a plan/run mismatch that pg_prove reports as PASS', () => {
    const hits = findGateFailures(MISMATCH_BUT_PASSING);

    expect(hits).toHaveLength(1);
    expect(hits[0].label).toMatch(/plan\(\) does not match/);
    expect(hits[0].lines).toEqual(['# Looks like you planned 15 tests but ran 2']);
  });

  it("flags TAP::Harness's own bad-plan wording too", () => {
    const hits = findGateFailures(TRUNCATED);

    expect(hits).toHaveLength(1);
    expect(hits[0].lines[0]).toContain('You planned 4 tests but ran 2');
  });

  it('flags finish() reporting failed assertions', () => {
    const hits = findGateFailures('# Looks like you failed 3 tests of 15\nResult: PASS');

    expect(hits).toHaveLength(1);
    expect(hits[0].label).toMatch(/failed assertions/);
  });

  it('flags a file that planned tests but ran none', () => {
    const hits = findGateFailures('psql:x.test.sql:40: ERROR:  # No tests run!');

    expect(hits).toHaveLength(1);
    expect(hits[0].label).toMatch(/ran none/);
  });

  it('reports every distinct mismatch in a multi-file run', () => {
    const hits = findGateFailures(
      '# Looks like you planned 41 tests but ran 2\n# Looks like you planned 15 tests but ran 2\n'
    );

    expect(hits).toHaveLength(1);
    expect(hits[0].lines).toHaveLength(2);
  });

  it('passes a clean run', () => {
    expect(findGateFailures(CLEAN)).toEqual([]);
  });

  it('does not fire on ordinary passing output that mentions a plan', () => {
    expect(findGateFailures('ok 7 - the planner uses the tier index\n1..15\nResult: PASS')).toEqual(
      []
    );
  });
});
