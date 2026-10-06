// QA-0 flow harness entry point: `pnpm qa:flows [flow …]`.
//
//   pnpm qa:flows onboarding                  # one flow, all its variants
//   pnpm qa:flows                             # every flow in tests/flows/flows.mjs
//   pnpm qa:flows onboarding -- --project phone-native   # extra args go to Playwright
//
// Needs the local stack (`pnpm stack` / `pnpm supabase:start`) and `pnpm dev:mfa`
// (admin@ flows). Playwright starts `pnpm dev` itself on E2E_PORT (default 3000),
// or reuses one already running there: `E2E_PORT=7000 pnpm qa:flows onboarding`.
//
// Output: flow-screenshots/<flow>/<variant>/NN-step.png + flow.json, then the
// contact sheet (contact-sheet.mjs): flow-screenshots/index.html,
// flow-screenshots/<flow>/contact-sheet.png and flow-screenshots/summary.md.
// The exit code is Playwright's, so a failed assert fails the run — but the
// contact sheet is always built, failures included.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { FLOWS } = await import(pathToFileURL(join(ROOT, 'tests', 'flows', 'flows.mjs')).href);

const argv = process.argv.slice(2).filter((a) => a !== '--');
const names = [];
while (argv.length && !argv[0].startsWith('-')) names.push(argv.shift());
const flows = names.length ? names : Object.keys(FLOWS);
const unknown = flows.filter((f) => !FLOWS[f]);
if (unknown.length) {
  console.error(`unknown flow(s): ${unknown.join(', ')} — known: ${Object.keys(FLOWS).join(', ')}`);
  process.exit(2);
}

const pw = spawnSync(
  'pnpm',
  ['exec', 'playwright', 'test', '-c', 'tests/flows/playwright.config.ts', ...flows.map((f) => `tests/flows/${f}.flow.ts`), ...argv],
  { cwd: ROOT, stdio: 'inherit' },
);
const sheet = spawnSync(process.execPath, [join(ROOT, 'scripts', 'flow-shots', 'contact-sheet.mjs'), ...flows], {
  cwd: ROOT,
  stdio: 'inherit',
});
process.exit(pw.status !== 0 ? (pw.status ?? 1) : (sheet.status ?? 1));
