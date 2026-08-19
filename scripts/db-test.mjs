#!/usr/bin/env node
// `supabase test db` + the plan/run gate that pg_prove itself does not apply
// (86eykjgrb). Streams the normal pg_prove output through unchanged, then fails
// the build if pgTAP's own diagnostics contradict the harness's PASS — or if the
// run cannot prove it executed anything at all.
// Detection logic (and why each pattern matters) lives in lib/pgtap-gate.mjs.
//
// Three properties this file has to hold, because the gate's whole value is that
// you can trust it to go red:
//
//  * stdout and stderr are captured SEPARATELY. They are independent pipes, so
//    merging them into one buffer lets a chunk boundary in one stream split a
//    diagnostic across an unrelated write from the other — and a split line
//    matches nothing. The gate scans each stream on its own.
//  * exit is via `process.exitCode`, never `process.exit()`. When stdout/stderr
//    are pipes (they are, under GitHub Actions) Node's writes to them are
//    asynchronous, and process.exit() drops whatever is still queued — which is
//    precisely the diagnostic this script exists to print.
//  * arguments are forwarded, so `pnpm db:test -- path/to/one.test.sql` still
//    targets one file instead of silently running all 56.
import { spawn } from 'node:child_process';
import {
  findGateFailures,
  findMissingRunEvidence,
  formatGateFailures,
  formatGateSuccess,
  formatMissingRunEvidence,
  readRunSummary,
} from './lib/pgtap-gate.mjs';

function runSupabaseTestDb(args) {
  return new Promise((resolve) => {
    const child = spawn('supabase', ['test', 'db', ...args]);
    // One accumulator per pipe — see the header comment.
    const captured = { stdout: '', stderr: '' };

    for (const [name, stream, sink] of [
      ['stdout', child.stdout, process.stdout],
      ['stderr', child.stderr, process.stderr],
    ]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        captured[name] += chunk;
        sink.write(chunk);
      });
    }

    child.on('error', (err) => {
      console.error(`\n✖ Could not run \`supabase test db\`: ${err.message}\n`);
      resolve({ code: 1, streams: [captured.stdout, captured.stderr] });
    });
    child.on('close', (code) =>
      resolve({ code: code ?? 1, streams: [captured.stdout, captured.stderr] })
    );
  });
}

const { code, streams } = await runSupabaseTestDb(process.argv.slice(2));
const hits = findGateFailures(streams);

if (code !== 0) {
  // pg_prove already failed the build. Still name what the output shows: a bare
  // exit code makes the reader hunt, and `# No tests run!` in particular arrives
  // on this path (pgTAP RAISEs it, so psql exits non-zero).
  if (hits.length > 0) console.error(formatGateFailures(hits, { harnessExitCode: code }));
  console.error(`\n✖ \`supabase test db\` exited ${code}.\n`);
  process.exitCode = code;
} else if (hits.length > 0) {
  console.error(formatGateFailures(hits));
  process.exitCode = 1;
} else {
  const missing = findMissingRunEvidence(streams);
  if (missing.length > 0) {
    console.error(formatMissingRunEvidence(missing));
    process.exitCode = 1;
  } else {
    console.log(formatGateSuccess(readRunSummary(streams)));
  }
}
