#!/usr/bin/env node
// Stop hook: refuses to end a session while .claude/clickup-session.json says a
// ClickUp task this session picked up has not been synced (status + end-of-session
// comment) with what actually happened. The marker is written and maintained by the
// clickup-task skill (.claude/skills/clickup-task/SKILL.md); this hook only enforces
// it. Sessions that never touched a ClickUp task have no marker and are unaffected.

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
const markerPath = join(root, '.claude', 'clickup-session.json');
if (!existsSync(markerPath)) process.exit(0);

let marker;
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf8'));
} catch {
  console.log(
    JSON.stringify({
      decision: 'block',
      reason:
        `The ClickUp session marker ${markerPath} is not valid JSON. Repair it ` +
        '(shape: {"tasks":[{"id":"86ey…","synced":false}]}) or, if the task it ' +
        'referred to is already in sync in ClickUp, delete the file. Then stop again.',
    }),
  );
  process.exit(0);
}

const tasks = Array.isArray(marker?.tasks) ? marker.tasks : [];
const unsynced = tasks.filter((t) => t && t.synced !== true);
if (unsynced.length === 0) process.exit(0);

const ids = unsynced.map((t) => t?.id ?? '<missing id>').join(', ');
console.log(
  JSON.stringify({
    decision: 'block',
    reason:
      `ClickUp is not in sync for task(s) ${ids} (marker: ${markerPath}). ` +
      'Per the clickup-task skill: make each task\'s status + latest comment match ' +
      'what actually happened this session — end-of-session comment (what changed, ' +
      'PR link, tests as actually run, what is left for Max), status per the ' +
      'transition rules (never `complete` for a merely-open PR; back to `to do` if ' +
      'nothing was built). Then set "synced": true for that task in the marker file ' +
      'and stop again. If the marker is stale — left by a crashed or earlier session ' +
      'and the task is already in sync — delete the marker file instead.',
  }),
);
process.exit(0);
