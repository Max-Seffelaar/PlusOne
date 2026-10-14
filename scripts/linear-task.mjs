#!/usr/bin/env node
// Linear fallback CLI for sessions WITHOUT the Linear MCP connector (a cloud
// container, CI, a laptop where the connector is down). The linear-task skill
// (.claude/skills/linear-task/SKILL.md) prefers the MCP tools; this script covers
// the same four moves over the GraphQL API with a personal API key (PLU-70).
//
//   node scripts/linear-task.mjs get PLU-70
//   node scripts/linear-task.mjs state PLU-70 "In Review"
//   node scripts/linear-task.mjs comment PLU-70 "Einde sessie: …"
//   node scripts/linear-task.mjs comment PLU-70 --file notes.md
//   node scripts/linear-task.mjs drift [--team PLU]
//
// Auth: LINEAR_API_KEY (Linear → Settings → Security & access → Personal API
// keys). Server-side/script use only — never NEXT_PUBLIC, never committed, never
// printed. The key is sent as the Authorization header; errors never echo it.
//
// `drift` replaces the daily ClickUp↔GitHub reconcile: it lists every started
// issue (In Progress / In Review / Merged - Testen) of the team and checks it
// against GitHub PRs that carry the issue key, plus open PRs whose key points at
// an issue that is not started. Exit code 1 when drift is found, so a scheduled
// routine can alert on it. Needs `gh` authenticated against the repo.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const API = 'https://api.linear.app/graphql';
const KEY_RE = /\b([A-Z][A-Z0-9]{1,5}-\d+)\b/i;

function fail(message) {
  console.error(message);
  process.exit(1);
}

async function gql(query, variables = {}) {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    fail(
      'LINEAR_API_KEY is not set. Create a personal API key in Linear (Settings → ' +
        'Security & access) and export it in this shell only; never put it in .env.local ' +
        'of a checkout that is shared or in anything NEXT_PUBLIC.'
    );
  }
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: key },
    body: JSON.stringify({ query, variables }),
  });
  let json = {};
  try {
    json = await res.json();
  } catch {
    // fall through to the status check below
  }
  if (!res.ok || json.errors) {
    const detail = json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    fail(`Linear API: ${detail}`);
  }
  return json.data;
}

function requireKey(arg) {
  if (!arg || !KEY_RE.test(arg)) fail(`Expected an issue key like PLU-70, got "${arg ?? ''}".`);
  return arg.toUpperCase();
}

async function cmdGet(key) {
  const data = await gql(
    `query($id: String!) {
      issue(id: $id) {
        identifier title url branchName
        state { name }
        labels { nodes { name } }
        assignee { name }
        project { name }
        parent { identifier }
        description
        comments(last: 5) { nodes { createdAt user { name } body } }
      }
    }`,
    { id: key }
  );
  const i = data.issue;
  if (!i) fail(`${key} not found.`);
  console.log(`${i.identifier} — ${i.title}`);
  console.log(
    `state: ${i.state?.name} · labels: ${i.labels.nodes.map((l) => l.name).join(', ') || '—'}`
  );
  console.log(
    `project: ${i.project?.name ?? '—'} · parent: ${i.parent?.identifier ?? '—'} · assignee: ${i.assignee?.name ?? '—'}`
  );
  console.log(`branch: ${i.branchName}`);
  console.log(`url: ${i.url}`);
  console.log('\n--- description ---\n' + (i.description ?? '(empty)'));
  if (i.comments.nodes.length) {
    console.log('\n--- last comments (oldest first) ---');
    for (const c of i.comments.nodes) {
      console.log(`\n[${c.createdAt}] ${c.user?.name ?? 'agent'}:\n${c.body}`);
    }
  }
}

async function cmdState(key, stateName) {
  if (!stateName) fail('Usage: state <KEY> "<state name>"');
  const data = await gql(
    `query($id: String!) {
      issue(id: $id) { id identifier state { name } team { states { nodes { id name } } } }
    }`,
    { id: key }
  );
  const i = data.issue;
  if (!i) fail(`${key} not found.`);
  const states = i.team.states.nodes;
  const target = states.find((s) => s.name.toLowerCase() === stateName.toLowerCase());
  if (!target) {
    fail(
      `No state "${stateName}" on this team. Available: ${states.map((s) => s.name).join(' | ')}`
    );
  }
  const upd = await gql(
    `mutation($id: String!, $stateId: String!) {
      issueUpdate(id: $id, input: { stateId: $stateId }) { success issue { identifier state { name } } }
    }`,
    { id: i.id, stateId: target.id }
  );
  if (!upd.issueUpdate.success) fail('issueUpdate returned success=false');
  console.log(`${i.identifier}: ${i.state.name} → ${upd.issueUpdate.issue.state.name}`);
}

async function cmdComment(key, args) {
  let body;
  if (args[0] === '--file') {
    if (!args[1]) fail('Usage: comment <KEY> --file <path>');
    body = readFileSync(args[1], 'utf8');
  } else {
    body = args.join(' ');
  }
  if (!body.trim()) fail('Empty comment body.');
  const data = await gql(`query($id: String!) { issue(id: $id) { id identifier } }`, { id: key });
  if (!data.issue) fail(`${key} not found.`);
  const res = await gql(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success comment { url } }
    }`,
    { issueId: data.issue.id, body }
  );
  if (!res.commentCreate.success) fail('commentCreate returned success=false');
  console.log(`${data.issue.identifier}: comment posted ${res.commentCreate.comment.url}`);
}

function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8' });
  if (res.error || res.status !== 0) {
    fail(
      `gh ${args.slice(0, 2).join(' ')} failed: ${res.stderr?.trim() || res.error?.message || res.status}`
    );
  }
  return JSON.parse(res.stdout || '[]');
}

async function cmdDrift(args) {
  const teamIdx = args.indexOf('--team');
  const team = teamIdx >= 0 ? args[teamIdx + 1] : 'PLU';
  if (!team) fail('Usage: drift [--team KEY]');

  const data = await gql(
    `query($team: String!) {
      issues(filter: { team: { key: { eq: $team } }, state: { type: { eq: "started" } } }, first: 200) {
        nodes { identifier title state { name } }
      }
    }`,
    { team }
  );
  const started = data.issues.nodes;
  const findings = [];

  for (const issue of started) {
    const prs = gh([
      'pr',
      'list',
      '--state',
      'all',
      '--limit',
      '20',
      '--search',
      `${issue.identifier} in:title`,
      '--json',
      'number,state,title,mergedAt',
    ]).filter((p) => new RegExp(`\\b${issue.identifier}\\b`, 'i').test(p.title));
    const open = prs.filter((p) => p.state === 'OPEN');
    const merged = prs.filter((p) => p.state === 'MERGED');
    const s = issue.state.name;
    const tag = (msg) => findings.push(`${issue.identifier} [${s}] ${msg}`);

    if (s === 'In Progress' && merged.length && !open.length) {
      tag(`PR #${merged[0].number} is merged → expected "Merged - Testen" (or Done after test)`);
    } else if (s === 'In Progress' && open.length) {
      tag(`PR #${open[0].number} is open → expected "In Review"`);
    } else if (s === 'In Review' && !open.length) {
      tag(
        merged.length
          ? `PR #${merged[0].number} is merged → expected "Merged - Testen"`
          : 'no open PR carries this key → back to In Progress, or open the PR'
      );
    } else if (s === 'Merged - Testen' && !merged.length) {
      tag('no merged PR carries this key → status is ahead of GitHub');
    }
  }

  const startedKeys = new Set(started.map((i) => i.identifier));
  const openPrs = gh([
    'pr',
    'list',
    '--state',
    'open',
    '--limit',
    '100',
    '--json',
    'number,title,headRefName',
  ]);
  const strayKeys = new Set();
  for (const pr of openPrs) {
    const m = KEY_RE.exec(pr.title) || KEY_RE.exec(pr.headRefName);
    if (!m) continue;
    const key = m[1].toUpperCase();
    if (!key.startsWith(`${team}-`) || startedKeys.has(key)) continue;
    strayKeys.add(`${key}|#${pr.number}`);
  }
  for (const entry of strayKeys) {
    const [key, pr] = entry.split('|');
    const d = await gql(`query($id: String!) { issue(id: $id) { identifier state { name } } }`, {
      id: key,
    });
    const state = d.issue?.state?.name ?? 'not found';
    findings.push(`${key} [${state}] open PR ${pr} carries this key → expected "In Review"`);
  }

  if (!findings.length) {
    console.log(
      `No Linear↔GitHub drift for team ${team} (${started.length} started issues, ${openPrs.length} open PRs).`
    );
    return;
  }
  console.log(`Linear↔GitHub drift for team ${team}:`);
  for (const f of findings) console.log(`- ${f}`);
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'get':
    await cmdGet(requireKey(rest[0]));
    break;
  case 'state':
    await cmdState(requireKey(rest[0]), rest.slice(1).join(' '));
    break;
  case 'comment':
    await cmdComment(requireKey(rest[0]), rest.slice(1));
    break;
  case 'drift':
    await cmdDrift(rest);
    break;
  default:
    fail(
      'Usage:\n  linear-task.mjs get <KEY>\n  linear-task.mjs state <KEY> "<state>"\n' +
        '  linear-task.mjs comment <KEY> <text> | --file <path>\n  linear-task.mjs drift [--team KEY]'
    );
}
