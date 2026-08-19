#!/usr/bin/env node
// `supabase test db` + the plan/run gate that pg_prove itself does not apply
// (86eykjgrb). Streams the normal pg_prove output through unchanged, then fails
// the build if pgTAP's own diagnostics contradict the harness's PASS.
// Detection logic (and why each pattern matters) lives in lib/pgtap-gate.mjs.
import { spawn } from 'node:child_process';
import { findGateFailures, formatGateFailures } from './lib/pgtap-gate.mjs';

function runSupabaseTestDb() {
  return new Promise((resolve) => {
    const child = spawn('supabase', ['test', 'db']);
    let output = '';

    for (const [stream, sink] of [
      [child.stdout, process.stdout],
      [child.stderr, process.stderr],
    ]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        output += chunk;
        sink.write(chunk);
      });
    }

    child.on('error', (err) => {
      console.error(`\n✖ Could not run \`supabase test db\`: ${err.message}\n`);
      resolve({ code: 1, output });
    });
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

const { code, output } = await runSupabaseTestDb();

if (code !== 0) {
  console.error(`\n✖ \`supabase test db\` exited ${code}.\n`);
  process.exit(code);
}

const hits = findGateFailures(output);
if (hits.length > 0) {
  console.error(formatGateFailures(hits));
  process.exit(1);
}

console.log('\n✔ pgTAP plan/run gate: every file ran exactly the assertions it planned.\n');
