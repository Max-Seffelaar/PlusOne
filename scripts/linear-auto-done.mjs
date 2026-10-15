#!/usr/bin/env node
// Runs in .github/workflows/linear-auto-done.yml when a PR merges into main
// (PLU-125). The decision lives in scripts/lib/linear-auto-done.mjs; this file
// only gathers facts and talks to Linear.
//
// Inputs (env): LINEAR_API_KEY, GH_TOKEN, REPO, PR_NUMBER, PR_TITLE, PR_BODY.
// Title and body arrive through env, never interpolated into a shell line, so a
// PR title cannot inject commands.
//
// Without LINEAR_API_KEY it logs a notice and exits 0: the workflow must never
// turn a merge red over bookkeeping.

import { spawnSync } from 'node:child_process';
import { planAutoDone, TERMINAL_STATES } from './lib/linear-auto-done.mjs';

const API = 'https://api.linear.app/graphql';
const { LINEAR_API_KEY, REPO, PR_NUMBER, PR_TITLE = '', PR_BODY = '' } = process.env;

// Linear's own "on merge → Merged - Testen" automation fires from the same merge.
// Wait for it before moving the issue on, so it cannot land after us and pull a
// Done issue back. Bounded: after the window we act anyway.
const SETTLE_TRIES = 12;
const SETTLE_MS = 5000;

async function gql(query, variables = {}) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: LINEAR_API_KEY },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors) {
    throw new Error(json.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`);
  }
  return json.data;
}

function changedFiles() {
  const res = spawnSync(
    'gh',
    ['api', '--paginate', `repos/${REPO}/pulls/${PR_NUMBER}/files`, '--jq', '.[].filename'],
    { encoding: 'utf8' }
  );
  if (res.status !== 0) throw new Error(`gh api pulls/files failed: ${res.stderr.trim()}`);
  return res.stdout.split('\n').filter(Boolean);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function loadIssue(key) {
  const d = await gql(
    `query($id: String!) {
      issue(id: $id) { id identifier state { name } team { states { nodes { id name } } } }
    }`,
    { id: key }
  );
  return d.issue;
}

async function settle(key) {
  let issue = await loadIssue(key);
  for (let i = 0; issue && i < SETTLE_TRIES; i++) {
    if (issue.state.name === 'Merged - Testen' || TERMINAL_STATES.includes(issue.state.name)) {
      break;
    }
    await sleep(SETTLE_MS);
    issue = await loadIssue(key);
  }
  return issue;
}

async function comment(issueId, body) {
  await gql(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) { success }
    }`,
    { issueId, body }
  );
}

async function update(issueId, input) {
  const d = await gql(
    `mutation($id: String!, $input: IssueUpdateInput!) {
      issueUpdate(id: $id, input: $input) { success }
    }`,
    { id: issueId, input }
  );
  if (!d.issueUpdate.success) throw new Error('issueUpdate returned success=false');
}

async function main() {
  if (!LINEAR_API_KEY) {
    console.log('::notice::LINEAR_API_KEY not set; skipping Linear auto-done.');
    return;
  }
  const prNumber = Number(PR_NUMBER);
  const plan = planAutoDone({ title: PR_TITLE, body: PR_BODY, files: changedFiles(), prNumber });
  console.log(`PR #${prNumber}: keys=${plan.keys.join(',') || '—'} test=${plan.mode} action=${plan.action}`);
  if (plan.action === 'none') return;

  const viewer = (await gql('query { viewer { id } }')).viewer;
  let failed = 0;
  for (const key of plan.keys) {
    try {
      const issue = await settle(key);
      if (!issue) {
        console.log(`::warning::${key} not found in Linear.`);
        continue;
      }
      if (TERMINAL_STATES.includes(issue.state.name)) {
        console.log(`${key}: already ${issue.state.name}, left alone.`);
        continue;
      }
      const states = issue.team.states.nodes;
      const byName = (n) => states.find((s) => s.name.toLowerCase() === n.toLowerCase());
      if (plan.action === 'done') {
        const done = byName('Done');
        if (!done) throw new Error('team has no "Done" state');
        await update(issue.id, { stateId: done.id });
      } else {
        // wait-prod / assign-max: make sure the issue is at least Merged - Testen.
        const merged = byName('Merged - Testen');
        const input = {};
        if (merged && issue.state.name !== merged.name) input.stateId = merged.id;
        if (plan.action === 'assign-max') input.assigneeId = viewer.id;
        if (Object.keys(input).length) await update(issue.id, input);
      }
      await comment(issue.id, plan.comment);
      console.log(`${key}: ${plan.action} ✓`);
    } catch (err) {
      failed++;
      console.log(`::warning::${key}: ${err.message}`);
    }
  }
  // Bookkeeping never fails the merge pipeline; the daily drift check catches
  // anything this run left behind.
  if (failed) console.log(`::warning::${failed} issue(s) not updated; see above.`);
}

main().catch((err) => {
  console.log(`::warning::linear-auto-done: ${err.message}`);
});
