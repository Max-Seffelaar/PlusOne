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
    // plan() ran but nothing did — pgTAP raises this and psql keeps going.
    re: /# No tests run!/i,
    label: 'a pgTAP file planned tests but ran none',
  },
];

// Returns [{ label, lines }] for every pattern the combined stdout/stderr of a
// `supabase test db` run matched; an empty array means the run is clean.
export function findGateFailures(output) {
  const lines = String(output).split('\n');
  return FAILURE_PATTERNS.flatMap(({ re, label }) => {
    const hits = lines.filter((line) => re.test(line)).map((line) => line.trim());
    return hits.length === 0 ? [] : [{ label, lines: hits }];
  });
}

export function formatGateFailures(hits) {
  const out = ['', '✖ pgTAP plan/run gate failed — pg_prove reported PASS, but:', ''];
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
