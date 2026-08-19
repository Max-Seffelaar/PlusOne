// Detection half of the pgTAP plan/run gate (scripts/db-test.mjs), split out so
// it can be unit-tested without a running database — see
// tests/unit/pgtap-plan-run-gate.test.ts.
//
// Every pattern below is something `pg_prove` (and therefore `supabase test db`)
// exits 0 on. pg_prove does catch a "not ok" line and a file that dies mid-run —
// it passes ON_ERROR_STOP=1 to psql, so the TAP stream truncates and TAP::Harness
// reports a bad plan. What it does not catch is pgTAP's own bookkeeping
// disagreeing with a well-formed stream: finish() emits
// "# Looks like you planned 15 tests but ran 2" as a TAP *comment*, which the
// harness is free to ignore.
//
// Two rules hold everything here together, and both exist because a gate you
// cannot trust is worse than no gate at all:
//
//  1. Diagnostics are matched PER STREAM, never against a stdout+stderr merge.
//     `child.stdout` and `child.stderr` are independent pipes: a chunk boundary
//     in one can land mid-line while the other writes, and the merged buffer
//     would then contain "planned 15 tests but " + unrelated text + "ran 2" —
//     no single line matches, and the gate would wave through exactly the drift
//     it exists to catch. Hence every entry point here takes one string per
//     stream and scans each independently.
//  2. A clean scan is NOT a pass. "No failure pattern matched" is also what an
//     empty run looks like, so findMissingRunEvidence() demands positive proof
//     that pg_prove actually executed files and assertions before the caller is
//     allowed to print a success line.

export const FAILURE_PATTERNS = [
  {
    // pgTAP's finish() diagnostic, and TAP::Harness's own "Bad plan" wording.
    re: /planned \d+ tests? but ran \d+/i,
    label: "a pgTAP file's plan() does not match the number of assertions it ran",
  },
  {
    // finish() saw failures its counter did survive to report.
    re: /Looks like you failed \d+ tests? of \d+/i,
    label: 'a pgTAP file reported failed assertions in finish()',
  },
  {
    // plan() ran but nothing did. pgTAP RAISEs this, so psql (ON_ERROR_STOP=1)
    // also exits non-zero — the pattern earns its keep by putting a name on that
    // failure instead of leaving a bare exit code, so it is matched on both the
    // zero and non-zero exit paths.
    re: /# No tests run!/i,
    label: 'a pgTAP file planned tests but ran none',
  },
];

// Positive evidence that pg_prove actually ran something. Absence of failure is
// not success: a renamed tests directory, a changed CLI glob or a config edit
// all produce a clean, silent, zero-coverage exit 0.
const SUMMARY_RE = /\bFiles=(\d+),\s*Tests=(\d+)/;
const RESULT_PASS_RE = /^\s*Result:\s*PASS\b/i;

// Every entry point accepts either one string or one string per captured stream.
function toStreams(output) {
  const list = Array.isArray(output) ? output : [output];
  return list.filter((s) => s != null).map((s) => String(s));
}

function linesOf(stream) {
  return stream.split('\n');
}

// Returns [{ label, lines }] for every pattern matched in ANY captured stream;
// an empty array means the run carried none of them.
export function findGateFailures(output) {
  const streams = toStreams(output);
  return FAILURE_PATTERNS.flatMap(({ re, label }) => {
    const hits = [];
    for (const stream of streams) {
      for (const line of linesOf(stream)) {
        if (re.test(line)) hits.push(line.trim());
      }
    }
    return hits.length === 0 ? [] : [{ label, lines: hits }];
  });
}

// Parses pg_prove's run summary out of whichever stream carried it.
// Returns { files, tests, resultPass } — files/tests are null when no summary
// line was found at all.
export function readRunSummary(output) {
  const streams = toStreams(output);
  let files = null;
  let tests = null;
  let resultPass = false;

  for (const stream of streams) {
    for (const line of linesOf(stream)) {
      const m = SUMMARY_RE.exec(line);
      if (m) {
        files = Number(m[1]);
        tests = Number(m[2]);
      }
      if (RESULT_PASS_RE.test(line)) resultPass = true;
    }
  }

  return { files, tests, resultPass };
}

// The other half of the gate: what could NOT be confirmed about the run. An
// empty array means pg_prove demonstrably executed at least one file and at
// least one assertion and declared the run a pass.
export function findMissingRunEvidence(output) {
  const { files, tests, resultPass } = readRunSummary(output);
  const missing = [];

  if (files === null) {
    missing.push("pg_prove printed no run summary at all (no `Files=N, Tests=M` line)");
  } else {
    if (files < 1) missing.push(`pg_prove ran 0 test files (reported Files=${files})`);
    if (tests < 1) missing.push(`pg_prove ran 0 assertions (reported Tests=${tests})`);
  }
  if (!resultPass) missing.push('pg_prove never printed a `Result: PASS` line');

  return missing;
}

export function formatGateFailures(hits, { harnessExitCode = 0 } = {}) {
  const header =
    harnessExitCode === 0
      ? '✖ pgTAP plan/run gate failed — pg_prove reported PASS, but:'
      : `✖ pgTAP plan/run gate — \`supabase test db\` exited ${harnessExitCode}, and the output also shows:`;
  const out = ['', header, ''];
  for (const { label, lines } of hits) {
    out.push(`  ${label}:`);
    for (const line of lines) out.push(`    ${line}`);
    out.push('');
  }
  out.push(
    'A pgTAP file whose plan() and assertion count disagree is not a green test — the',
    'assertions past the drift point are unverified. Find the file in the output above.',
    'Do NOT lower plan(N) to match: that defines the defect away. Fix the cause.',
    '',
    'The usual cause is `rollback to savepoint`: pgTAP keeps its counter in the temp',
    'table __tcache__, so a rollback reverts it, while the test numbers it prints come',
    'from the non-transactional sequence __tresults___numb_seq. See the comment above',
    'finish() in supabase/tests/database/tiers.vat.test.sql.',
    ''
  );
  return out.join('\n');
}

export function formatMissingRunEvidence(missing) {
  return [
    '',
    '✖ pgTAP plan/run gate failed — the run exited 0 without proving it ran anything:',
    '',
    ...missing.map((line) => `    ${line}`),
    '',
    'Exit 0 with no failure diagnostics is also what zero coverage looks like: a renamed',
    'tests directory, a changed CLI glob or a `supabase/config.toml` edit all produce a',
    'silent, empty, successful run. The gate refuses to call that green.',
    '',
  ].join('\n');
}

export function formatGateSuccess({ files, tests }) {
  return `\n✔ pgTAP plan/run gate: ${files} files / ${tests} assertions ran, pg_prove reported PASS, and no file's plan disagreed with what it ran.\n`;
}
