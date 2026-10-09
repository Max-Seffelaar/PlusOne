// QA-0: which flows does a change set need? Reads the registry in tests/flows/flows.mjs.
//
//   node scripts/flow-shots/select.mjs --base <ref> [--head <ref>]   # git diff base...head
//   git diff --name-only … | node scripts/flow-shots/select.mjs       # paths on stdin
//   node scripts/flow-shots/select.mjs --self-check                   # registry ↔ files + README-only
//
// Prints the selected flow names space-separated on stdout (empty = run nothing);
// with GITHUB_OUTPUT set it also writes `flows=<names>` and `shards=<JSON list>`
// (the CI matrix: one shard per flow variant, FLOW_SHARDS in flows.mjs).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { FLOWS, FLOW_SHARDS, SHARED_PATHS } = await import(pathToFileURL(join(ROOT, 'tests', 'flows', 'flows.mjs')).href);

const matches = (file, prefixes) => prefixes.some((p) => file === p || file.startsWith(p));

/** Flow names (registry order) that a list of changed repo-relative paths needs. */
export function selectFlows(changed) {
  const files = changed.map((f) => f.trim().replace(/\\/g, '/')).filter(Boolean);
  if (files.some((f) => matches(f, SHARED_PATHS))) return Object.keys(FLOWS);
  return Object.entries(FLOWS)
    .filter(([name, def]) => files.some((f) => f === `tests/flows/${name}.flow.ts` || matches(f, def.paths)))
    .map(([name]) => name);
}

function selfCheck() {
  const problems = [];
  const onDisk = readdirSync(join(ROOT, 'tests', 'flows'))
    .filter((f) => f.endsWith('.flow.ts'))
    .map((f) => f.replace(/\.flow\.ts$/, ''));
  for (const name of onDisk) if (!FLOWS[name]) problems.push(`tests/flows/${name}.flow.ts has no entry in tests/flows/flows.mjs`);
  for (const name of Object.keys(FLOWS)) if (!onDisk.includes(name)) problems.push(`flows.mjs entry "${name}" has no tests/flows/${name}.flow.ts`);
  const cases = [
    [['README.md'], []],
    [['docs/changelog.md', 'CLAUDE.md'], []],
    ...Object.keys(FLOWS).map((name) => [[`tests/flows/${name}.flow.ts`], [name]]),
    [['tests/flows/harness.ts'], Object.keys(FLOWS)],
  ];
  for (const [input, want] of cases) {
    const got = selectFlows(input);
    if (got.join(' ') !== want.join(' ')) problems.push(`selectFlows(${JSON.stringify(input)}) = [${got}] — want [${want}]`);
  }
  // The CI matrix runs one shard per variant: a harness variant missing from
  // FLOW_SHARDS would never run in CI, an extra one would fail on an unknown project.
  const harness = readFileSync(join(ROOT, 'tests', 'flows', 'harness.ts'), 'utf8');
  const devices = harness.match(/const VARIANT_DEVICES = \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const variants = [...devices.matchAll(/^\s*'([a-z0-9-]+)':\s*\{/gm)].map((m) => m[1]);
  if (!variants.length) problems.push('could not read VARIANT_DEVICES from tests/flows/harness.ts');
  else if ([...variants].sort().join(' ') !== [...FLOW_SHARDS].sort().join(' '))
    problems.push(`FLOW_SHARDS [${FLOW_SHARDS}] in flows.mjs ≠ harness variants [${variants}]`);
  for (const p of [...SHARED_PATHS, ...Object.values(FLOWS).flatMap((d) => d.paths)]) {
    // A typo'd prefix would silently never match; every prefix must hit a tracked file.
    const hit = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', `${p}*`], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (!hit) problems.push(`path "${p}" in flows.mjs matches no tracked file`);
  }
  if (problems.length) {
    console.error(`flow registry self-check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }
  console.error(`flow registry self-check ok (${Object.keys(FLOWS).length} flows, ${FLOW_SHARDS.length} shards; README-only selects none)`);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--self-check')) {
    selfCheck();
  } else {
    const base = arg('--base');
    const changed = base
      ? execFileSync('git', ['diff', '--name-only', `${base}...${arg('--head') ?? 'HEAD'}`], { cwd: ROOT, encoding: 'utf8' }).split('\n')
      : readFileSync(0, 'utf8').split('\n');
    const flows = selectFlows(changed).join(' ');
    console.log(flows);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `flows=${flows}\nshards=${JSON.stringify(FLOW_SHARDS)}\n`);
  }
}
