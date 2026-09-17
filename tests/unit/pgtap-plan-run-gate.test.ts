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
 *
 * The second half of this file runs the REAL scripts/db-test.mjs as a child
 * process against a fake `supabase` on PATH, with its stdout/stderr as pipes —
 * the exact shape CI gives it. Those tests exist because the gate's only value is
 * that you can trust it to go red, and three review findings were about ways it
 * could stay green (or lose its own diagnostic) without anyone noticing. Each one
 * is pinned here as an executable regression, not an argument.
 */
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import {
  findGateFailures,
  findMissingRunEvidence,
  readRunSummary,
} from '../../scripts/lib/pgtap-gate.mjs';

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

  // The reason findGateFailures takes one string PER STREAM instead of one
  // merged buffer. stdout and stderr are independent pipes: a chunk boundary in
  // one can land mid-diagnostic while the other writes, and the merged text then
  // contains no line that matches. Scanned per stream, the diagnostic is intact.
  it('still matches when a stderr write would have split the diagnostic in a merged buffer', () => {
    const stdout = '# Looks like you planned 15 tests but ran 2\nok\nResult: PASS\n';
    const stderr = 'WARN: local stack is still warming up\n';
    // What the pre-fix single-buffer version saw when the pipes interleaved:
    const merged = '# Looks like you planned 15 tests but WARN: warming up\nran 2\nResult: PASS\n';

    expect(findGateFailures([stdout, stderr])).toHaveLength(1);
    expect(findGateFailures(merged)).toHaveLength(0); // the bug, pinned
  });

  it('finds a diagnostic that arrives on stderr rather than stdout', () => {
    expect(findGateFailures(['Result: PASS\n', 'psql:x.test.sql:40: ERROR:  # No tests run!\n']))
      .toHaveLength(1);
  });
});

describe('findMissingRunEvidence', () => {
  it('accepts a run that proves it executed files and assertions', () => {
    expect(findMissingRunEvidence(CLEAN)).toEqual([]);
    expect(readRunSummary(CLEAN)).toEqual({ files: 56, tests: 1092, resultPass: true });
  });

  // "No failure pattern matched" is also what zero coverage looks like.
  it('rejects a successful-looking run that executed no files', () => {
    const missing = findMissingRunEvidence('Files=0, Tests=0,  0 wallclock secs\nResult: NOTESTS\n');

    expect(missing).toEqual(
      expect.arrayContaining([
        expect.stringContaining('0 test files'),
        expect.stringContaining('0 assertions'),
        expect.stringContaining('Result: PASS'),
      ])
    );
  });

  it('rejects a run that printed no summary at all', () => {
    expect(findMissingRunEvidence('')).toEqual(
      expect.arrayContaining([expect.stringContaining('no run summary at all')])
    );
  });

  it('rejects a run that ran files but never declared a pass', () => {
    expect(findMissingRunEvidence('Files=56, Tests=1092,  4 wallclock secs\n')).toEqual([
      'pg_prove never printed a `Result: PASS` line',
    ]);
  });

  it('reads the summary out of whichever stream carried it', () => {
    expect(readRunSummary(['', 'Files=3, Tests=9,  1 wallclock secs\nResult: PASS\n'])).toEqual({
      files: 3,
      tests: 9,
      resultPass: true,
    });
  });
});

/* ------------------------------------------------------------------------- *
 * The gate end to end: the real scripts/db-test.mjs, spawned with pipes.
 * ------------------------------------------------------------------------- */

const DB_TEST = fileURLToPath(new URL('../../scripts/db-test.mjs', import.meta.url));
const fakeBinDirs: string[] = [];

/**
 * Writes a throwaway executable named `supabase` that replays a scripted
 * transcript, and returns a PATH with its directory in front. `steps` are
 * `[stream, text, delayMs]`; a delay forces the parent to see the two pipes
 * genuinely interleave rather than arrive pre-batched.
 */
function fakeSupabase(
  steps: Array<['out' | 'err', string, number?]>,
  exitCode = 0,
  { echoArgs = false } = {}
): string {
  const dir = mkdtempSync(join(tmpdir(), 'pgtap-gate-'));
  fakeBinDirs.push(dir);
  const bin = join(dir, 'supabase');
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const steps = ${JSON.stringify(steps)};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (${echoArgs}) process.stdout.write('ARGV:' + JSON.stringify(process.argv.slice(2)) + '\\n');
for (const [stream, text, delay] of steps) {
  if (delay) await sleep(delay);
  (stream === 'err' ? process.stderr : process.stdout).write(text);
}
process.exitCode = ${exitCode};
`,
    'utf8'
  );
  chmodSync(bin, 0o755);
  return `${dir}:${process.env.PATH ?? ''}`;
}

/** Runs the real gate script and captures everything it managed to emit. */
function runGate(
  path: string,
  args: string[] = [],
  { pauseStderrMs = 0 } = {}
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [DB_TEST, ...args], {
      env: { ...process.env, PATH: path },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      stdout += c;
    });
    child.stderr.on('error', () => {});

    const attachStderr = () => {
      child.stderr.on('data', (c) => {
        stderr += c;
      });
      child.stderr.resume();
    };
    if (pauseStderrMs > 0) {
      // A reader that is briefly busy — a log collector, a CI runner. The pipe
      // fills at 64 KB; anything past that is queued in the writer.
      child.stderr.pause();
      setTimeout(attachStderr, pauseStderrMs);
    } else {
      attachStderr();
    }

    let settled = false;
    const done = (code: number | null) => {
      if (settled) return;
      settled = true;
      resolve({ code, stdout, stderr });
    };
    child.on('close', (code) => setTimeout(() => done(code), 200));
  });
}

const SUMMARY = 'All tests successful.\nFiles=56, Tests=1092,  4 wallclock secs\nResult: PASS\n';

afterAll(() => {
  for (const dir of fakeBinDirs) execFileSync('rm', ['-rf', dir]);
});

describe('scripts/db-test.mjs end to end', () => {
  it('exits 0 and reports what it verified on a clean run', async () => {
    const { code, stdout } = await runGate(fakeSupabase([['out', `x.test.sql .. ok\n${SUMMARY}`]]));

    expect(code).toBe(0);
    // The success line names the numbers it checked — "nothing matched" alone is
    // not something the gate is allowed to call green.
    expect(stdout).toContain('56 files / 1092 assertions ran');
  });

  // Finding: stdout and stderr merged into one buffer, then matched line by line.
  // The fake writes the diagnostic in two stdout chunks with a stderr write timed
  // between them, so the merged buffer would read
  // "planned 15 tests but WARN: ...\nran 2". The gate must still go red.
  it('goes red when a stderr write lands inside the diagnostic', async () => {
    const { code, stderr } = await runGate(
      fakeSupabase([
        ['out', 'tiers.vat.test.sql ....\n'],
        ['out', '# Looks like you planned 15 tests but ', 30],
        ['err', 'WARN: local stack is still warming up\n', 60],
        ['out', `ran 2\nok\n${SUMMARY}`, 60],
      ])
    );

    expect(code).toBe(1);
    expect(stderr).toContain('pgTAP plan/run gate failed');
    expect(stderr).toContain('planned 15 tests but ran 2');
  });

  // Finding: process.exit() on a piped stderr can truncate the diagnostic this
  // script exists to print. 4000 distinct mismatches make the gate's own output
  // ~200 KB — far past the 64 KB pipe buffer — and the reader is busy for 250 ms.
  // With process.exit() this delivered 0 bytes; the assertion is that the LAST
  // line of the explanation still arrives.
  it('does not truncate its diagnostic when the reader is slow', async () => {
    const flood = Array.from(
      { length: 4000 },
      (_, i) => `# Looks like you planned ${i + 1} tests but ran 2`
    ).join('\n');
    const { code, stderr } = await runGate(
      fakeSupabase([['out', `${flood}\n${SUMMARY}`]]),
      [],
      { pauseStderrMs: 250 }
    );

    expect(code).toBe(1);
    expect(stderr).toContain('pgTAP plan/run gate failed');
    // The tail of formatGateFailures — the part that says what to do about it.
    expect(stderr).toContain('finish() in supabase/tests/database/tiers.vat.test.sql.');
  }, 20_000);

  // Finding: the success message asserts a property nothing verified.
  it('goes red when the run exits 0 having executed nothing', async () => {
    const { code, stderr, stdout } = await runGate(
      fakeSupabase([['out', 'Files=0, Tests=0,  0 wallclock secs\nResult: NOTESTS\n']])
    );

    expect(code).toBe(1);
    expect(stderr).toContain('without proving it ran anything');
    expect(stdout).not.toContain('✔');
  });

  it('goes red on a silent exit 0 with no output at all', async () => {
    const { code, stderr } = await runGate(fakeSupabase([]));

    expect(code).toBe(1);
    expect(stderr).toContain('no run summary at all');
  });

  // Finding: arguments to the wrapper are silently dropped.
  it('forwards its arguments to `supabase test db`', async () => {
    const { stdout } = await runGate(
      fakeSupabase([['out', `x.test.sql .. ok\n${SUMMARY}`]], 0, { echoArgs: true }),
      ['supabase/tests/database/events.test.sql']
    );

    // The subcommand is still there; the file argument is appended, not dropped.
    expect(stdout).toContain('ARGV:["test","db","supabase/tests/database/events.test.sql"]');
  });

  // pg_prove RAISEs on "# No tests run!", so psql exits non-zero and the harness
  // fails on its own. The gate still has to NAME it — a bare exit code makes the
  // reader hunt through 56 files of output.
  it("preserves a non-zero exit code and still labels what it found", async () => {
    const { code, stderr } = await runGate(
      fakeSupabase([['out', 'psql:x.test.sql:40: ERROR:  # No tests run!\nResult: FAIL\n']], 3)
    );

    expect(code).toBe(3);
    expect(stderr).toContain('planned tests but ran none');
    expect(stderr).toContain('exited 3');
  });
});
