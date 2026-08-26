#!/usr/bin/env node
// One environment-setup codepath for every place this repo gets provisioned:
//
//   laptop              node scripts/session-setup.mjs install   (then: check)
//   Claude web session  .claude/hooks/session-start.sh → install (SessionStart hook)
//   CI                  .github/workflows/ci.yml → install, then check
//
// One script on purpose: two setups that must do the same thing WILL drift
// apart, and then you debug environment differences instead of code.
//
// Modes:
//   inventory  (default) read-only: versions, tools, which suites can run here.
//              Writes nothing — every mode starts by looking, never by writing.
//   install    inventory + `pnpm install --frozen-lockfile`.
//   check      run the pure-node CI suites (CORE_SUITES), then report honestly
//              which CI suites did NOT run here.
//
// THE RULE (printed into every web session's context via the SessionStart
// hook): do not make the app weaker to make the setup easier. If a guard test,
// the frozen lockfile, or a build guard refuses, the refusal is the signal —
// fix the environment or flag the conflict. A setup that goes green by
// disabling a guard tests something other than what runs in prod.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// The pure-node half of CI's `lint-and-test` job. Every name is validated
// against package.json before anything runs: a from-memory suite list once
// named a script that does not exist on main, and the mistake surfaced mid-run
// as a confusing pnpm error instead of "this list drifted" (26/8). The
// manifest is the source of truth; this list only adds ordering and args.
// `test` gets an explicit `run` arg so it is a single pass everywhere — bare
// `vitest` would watch in an interactive terminal but run once in CI.
const CORE_SUITES = [
  { script: 'lint' },
  { script: 'type-check' },
  { script: 'test', args: ['run'] },
];

// CI suites that need the local Supabase stack (docker) or a built app.
// `check` never runs these; it names them instead, so "check is green" is
// never mistaken for "CI is green".
const STACK_SUITES = ['db:test', 'db:test:concurrency', 'e2e:smoke'];

function readManifest() {
  return JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function capture(cmd, args, timeout = 10_000) {
  try {
    const r = spawnSync(cmd, args, { encoding: 'utf8', cwd: root, timeout });
    return r.status === 0 ? r.stdout.trim() : null;
  } catch {
    return null;
  }
}

/** Node major CI pins (single source: ci.yml), or null if the pin moved. */
function ciNodeMajor() {
  try {
    const yml = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8');
    const m = yml.match(/node-version:\s*['"]?(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

/** Suite names in `list` that package.json does not define. */
function missingFromManifest(manifest, list) {
  return list.filter((name) => !manifest.scripts?.[name]);
}

function inventory(manifest) {
  const out = [];
  const warn = [];

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  const ciMajor = ciNodeMajor();
  out.push(
    `node v${process.versions.node}` +
      (ciMajor === null
        ? ' (could not read the CI pin from ci.yml)'
        : nodeMajor >= ciMajor
          ? ` (ok — CI pins ${ciMajor})`
          : ` — CI pins ${ciMajor}`)
  );
  if (ciMajor !== null && nodeMajor < ciMajor) {
    warn.push(
      `Node ${nodeMajor} < CI's ${ciMajor}: supabase-js ≥2.108 needs native WebSocket ` +
        '(see ci.yml) — expect client-constructor throws in e2e/server paths.'
    );
  }

  const pnpmVersion = capture('pnpm', ['--version']);
  const wanted = (manifest.packageManager ?? '').split('@')[1] ?? null;
  if (pnpmVersion === null) {
    out.push(`pnpm: NOT FOUND (packageManager wants ${manifest.packageManager}; install will try corepack)`);
  } else {
    out.push(
      `pnpm ${pnpmVersion}` +
        (wanted && pnpmVersion !== wanted ? ` (packageManager pins ${wanted})` : ' (matches packageManager)')
    );
  }

  out.push(
    `pnpm-lock.yaml ${existsSync(resolve(root, 'pnpm-lock.yaml')) ? 'present' : 'MISSING'}; ` +
      `node_modules ${existsSync(resolve(root, 'node_modules')) ? 'present' : 'absent'}; ` +
      `.env.local ${existsSync(resolve(root, '.env.local')) ? 'present' : 'absent (only pnpm dev/e2e need it — unit suites need no env)'}`
  );

  const supabase = capture('supabase', ['--version'], 5_000);
  const dockerUp =
    spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 5_000 }).status === 0;
  out.push(`supabase CLI: ${supabase ?? 'not installed'}; docker daemon: ${dockerUp ? 'up' : 'unreachable'}`);

  const missingCore = missingFromManifest(manifest, CORE_SUITES.map((s) => s.script));
  const missingStack = missingFromManifest(manifest, STACK_SUITES);
  for (const name of [...missingCore, ...missingStack]) {
    warn.push(`suite '${name}' is in this script's list but NOT in package.json — the list drifted; fix it here.`);
  }

  const stackReady = supabase !== null && dockerUp;
  out.push(
    `runnable here after install: ${CORE_SUITES.map((s) => s.script).join(', ')} ` +
      '(node scripts/session-setup.mjs check)'
  );
  out.push(
    `stack-dependent CI suites (${STACK_SUITES.join(', ')}): ` +
      (stackReady
        ? 'stack tooling present — start it with `pnpm supabase:start` first'
        : 'not runnable until a supabase CLI + docker daemon are present (true right now)')
  );

  console.log('[session-setup] PlusOne Guestlist — environment inventory');
  for (const line of out) console.log(`  ${line}`);
  for (const line of warn) console.log(`  WARNING: ${line}`);
  console.log(
    '\n  RULE — never make the app weaker to make the setup easier: if a guard\n' +
      '  test, the frozen lockfile, or a build guard refuses, the refusal is the\n' +
      '  signal. Fix the environment or flag the conflict; never disable/skip a\n' +
      '  guard, loosen a config, or hand-edit pnpm-lock.yaml to get past setup.\n' +
      '  A weakened setup tests something other than what runs in prod.\n'
  );

  return { pnpmVersion, missingCore };
}

function ensurePnpm(manifest, inv) {
  if (inv.pnpmVersion !== null) return;
  // corepack reads the exact pin from the manifest's packageManager field —
  // nothing here decides a version.
  console.log(`[session-setup] pnpm missing — activating via corepack (${manifest.packageManager})`);
  if (run('corepack', ['enable']) !== 0 || run('corepack', ['prepare', manifest.packageManager, '--activate']) !== 0) {
    console.error('[session-setup] could not activate pnpm via corepack. Install pnpm, then re-run.');
    process.exit(1);
  }
}

function install(manifest, inv) {
  ensurePnpm(manifest, inv);
  console.log('[session-setup] pnpm install --frozen-lockfile');
  const status = run('pnpm', ['install', '--frozen-lockfile']);
  if (status !== 0) {
    console.error(
      '\n[session-setup] frozen-lockfile refused: package.json and pnpm-lock.yaml disagree.\n' +
        'If package.json changed intentionally, run `pnpm install` so pnpm regenerates the\n' +
        'lockfile and commit BOTH files. Never hand-edit or delete the lockfile, and never\n' +
        'drop --frozen-lockfile here to get past this — CI uses the same flag.'
    );
    process.exit(status);
  }
  console.log('[session-setup] install done.');
}

function check(manifest) {
  // Validate the whole list against the manifest BEFORE running anything, so
  // a drifted name fails as "the list drifted", never as a mid-run mystery.
  const missing = missingFromManifest(manifest, CORE_SUITES.map((s) => s.script));
  if (missing.length > 0) {
    console.error(
      `[session-setup] suite list drifted from package.json — missing: ${missing.join(', ')}.\n` +
        'Fix CORE_SUITES in scripts/session-setup.mjs (or restore the script in package.json);\n' +
        'do not guess a replacement command.'
    );
    process.exit(1);
  }

  const gh = process.env.GITHUB_ACTIONS === 'true';
  for (const suite of CORE_SUITES) {
    const argv = ['run', suite.script, ...(suite.args ?? [])];
    const label = `pnpm ${argv.join(' ')}`;
    if (gh) console.log(`::group::${label}`);
    else console.log(`\n[session-setup] ${label}`);
    const status = run('pnpm', argv);
    if (gh) console.log('::endgroup::');
    if (status !== 0) {
      console.error(`[session-setup] FAILED: ${label}`);
      process.exit(status);
    }
  }

  console.log(
    `\n[session-setup] core suites green: ${CORE_SUITES.map((s) => s.script).join(', ')}.\n` +
      `NOT run by this command: ${STACK_SUITES.join(', ')} (need the local Supabase\n` +
      'stack) and `pnpm build` — CI runs those in the same lint-and-test job, and the\n' +
      'migration-duplicate check runs via the pre-push hook + CI. check ≠ CI green.'
  );
}

const mode = process.argv[2] ?? 'inventory';
const manifest = readManifest();
switch (mode) {
  case 'inventory':
    inventory(manifest);
    break;
  case 'install':
    install(manifest, inventory(manifest));
    break;
  case 'check':
    check(manifest);
    break;
  default:
    console.error('usage: node scripts/session-setup.mjs [inventory|install|check]');
    process.exit(2);
}
