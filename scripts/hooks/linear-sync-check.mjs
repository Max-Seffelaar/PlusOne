#!/usr/bin/env node
// Stop hook: refuses to end a session while .claude/linear-session.json says a
// Linear issue this session picked up has not been synced (status + end-of-session
// comment) with what actually happened. The marker is written and maintained by the
// linear-task skill (.claude/skills/linear-task/SKILL.md); this hook only enforces it.
// Sessions that never touched a Linear issue have no marker and are unaffected.
//
// The pre-2026-10-14 marker (.claude/clickup-session.json, {"tasks":[…]}) is still
// honoured: a stale one left by an older session keeps blocking until it is synced or
// deleted, instead of silently losing the bookkeeping it was guarding (PLU-70).

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

let input = {};
try {
  input = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // Unreadable stdin — fail open, this hook must never brick a session.
}

// A blocked stop re-runs this hook on the follow-up turn with stop_hook_active set;
// letting that pass prevents an infinite block loop when the model cannot comply.
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const markerPaths = [
  join(root, '.claude', 'linear-session.json'),
  join(root, '.claude', 'clickup-session.json'), // legacy marker, same contract
];

function block(reason) {
  console.log(JSON.stringify({ decision: 'block', reason }));
  process.exit(0);
}

for (const markerPath of markerPaths) {
  if (!existsSync(markerPath)) continue;

  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  } catch {
    block(
      `The Linear session marker ${markerPath} is not valid JSON. Repair it ` +
        '(shape: {"issues":[{"id":"PLU-123","synced":false}]}) or, if the issue it ' +
        'referred to is already in sync in Linear, delete the file. Then stop again.'
    );
  }

  const entries = [
    ...(Array.isArray(marker?.issues) ? marker.issues : []),
    ...(Array.isArray(marker?.tasks) ? marker.tasks : []), // legacy key
  ];
  const unsynced = entries.filter((e) => e && e.synced !== true);
  if (unsynced.length === 0) continue;

  const ids = unsynced.map((e) => e?.id ?? '<missing id>').join(', ');
  block(
    `Linear is not in sync for issue(s) ${ids} (marker: ${markerPath}). ` +
      "Per the linear-task skill: make each issue's status + latest comment match " +
      'what actually happened this session — end-of-session comment (what changed, ' +
      'PR link, tests as actually run, what is left for Max), status per the ' +
      'transition rules (In Review for an open PR, Merged - Testen for a merged one, ' +
      'Done only after merged AND tested, back to Todo if nothing was built). Then ' +
      'set "synced": true for that issue in the marker file and stop again. If the ' +
      'marker is stale — left by a crashed or earlier session and the issue is ' +
      'already in sync — delete the marker file instead.'
  );
}

process.exit(0);
