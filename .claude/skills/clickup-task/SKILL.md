---
name: clickup-task
description: Drive the ClickUp task lifecycle for PlusOne Guestlist work sessions. Use this skill EVERY time Max hands over work that lives in ClickUp — a pasted app.clickup.com/t/… link, a bare task id like 86ey9c5d2, "pak taak X op", "werk deze taken af", "zet de taak op in progress", "rond de taak af", "update de ClickUp-taak" — or when a session that started from a ClickUp task reaches a phase change (plan done, PR open, merged, blocked). It owns the status flow (to do → planning → in progress → complete), the comments on the task, and the end-of-session ClickUp update, including the rule that complete only happens after the work is merged AND tested — never when a PR is merely opened.
---

# ClickUp task lifecycle

CLAUDE.md describes how to *build*; this skill owns the bookkeeping *around* a task so
ClickUp always reflects reality. Past sessions drifted repeatedly — statuses stale
versus `main`, work finished without a trace on the task, and on 13/7 the whole list
had to be reconciled by hand against merged PRs. The fix is not more discipline, it's
making the ClickUp update part of the same motion as the work itself.

## The list and its statuses

All tasks live in list `901818739469` ("Gastenlijst App — Build met Claude Code").
Task URLs look like `https://app.clickup.com/t/<team_id>/<task_id>` — the **last**
segment is the task id for the MCP tools (`clickup_get_task`, `clickup_update_task`,
`clickup_create_comment`).

Exact status strings for `clickup_update_task` (the done-status is called
**`complete`**, not "done"):

| status | meaning here |
|---|---|
| `to do` | not picked up |
| `planning` | a session is producing a plan / design decision |
| `in progress` | a session is building |
| `complete` | merged to `main` **and** tested |

The list also has `at risk`, `update required`, `on hold`, `cancelled`. Those are
Max's to manage — never set them on your own initiative; if one seems right (e.g. the
task turns out obsolete), say so in a comment and let Max flip it.

## Step 0 — pick up the task (before touching any code)

1. `clickup_get_task` with `include: ["description"]`, plus `clickup_get_task_comments`.
   The task description is the assignment of record: if what Max typed in chat — or
   what the codebase actually contains — conflicts with it, surface the conflict
   instead of silently picking one. A description error with an obvious mechanical
   resolution (wrong path, renamed symbol) is flag-and-proceed in the pickup comment;
   anything that changes *what* is being built is blocked-on-Max.
2. **Concurrency check** — learned the hard way when two sessions built the same task
   in parallel and corrupted each other's test runs: if the status is already
   `planning` or `in progress`, or a recent comment / `gh pr list --search "<task-id>"`
   hit shows another session on it, stop and ask Max before proceeding.
3. Note the `Model:` line in the description. A mismatch with the current session
   (e.g. a Sonnet-mechanical task in a planning-model session) is worth one flagging
   sentence to Max, not a blocker — model routing is his call.
4. **Multiple tasks handed at once:** each task keeps its own status and comments.
   Default to one branch + PR per task; combine only when they are explicitly coupled
   follow-ups, and then say so in a comment on *both* tasks.
5. **Write the session marker** `.claude/clickup-session.json` (gitignored) in the
   project root: `{"tasks":[{"id":"<task-id>","synced":false}]}` — one entry per
   picked-up task. The Stop hook (`scripts/hooks/clickup-sync-check.mjs`) refuses to
   end the session while any entry has `synced: false`, so forgetting the end-of-session
   ClickUp update is structurally impossible. Flip `synced` to `true` only after the
   end-of-session comment is posted and the status matches reality. Include the task id
   in the branch name and PR title — that is what makes the concurrency check and any
   later reconciliation mechanical.
6. **Session name:** the model cannot rename a session itself (`/rename` is user-only,
   as of 07-2026). So at pickup, print one copy-paste-ready line in chat so Max can make
   the session name match the task exactly:
   `/rename <exact task name>`
   For sessions started from a terminal, `claude -n "<exact task name>"` at launch does
   the same without the paste.

## Status transitions — when exactly

- → `planning`: the moment a real plan phase starts (plan mode, design doc, a decision
  Max must make). Skip this state entirely for mechanical tasks whose description
  already contains concrete numbered steps — those go straight to `in progress`.
- → `in progress`: when building actually starts (first code/migration edit), not when
  you start reading. Also the transition out of `planning` once the plan is approved.
- → `complete`: **only** when both hold — (a) the PR is merged to `main`, and (b) the
  work is tested: for UI tasks Max answered the per-screen test handoff (or explicitly
  said it's good); for non-UI tasks the DoD suites green plus the applicable review
  gates count as tested. An open PR is *not* complete. If the session ends with an
  open PR: leave `in progress`, post the end-of-session comment (below), and let the
  merge+test confirmation — this session or a later one — flip it to `complete`.
- Session ends with **zero work done** (interrupted before the first edit, no PR):
  revert to `to do` — `in progress` would be false and would trip the next session's
  concurrency check. Say so in the end-of-session comment.
- Blocked on input only Max can give → keep the current status, post a comment that
  names the blocker and the exact question.

ClickUp records the status change itself; the comment that accompanies it carries the
context (plan summary, PR link, blocker). A status change without a comment is only
fine for the `planning`/`in progress` entry moments when the pickup comment already
said what's happening.

## Comments — what to post and when

Write comments in the language of the task (Max writes these in Dutch — keep them
Dutch, code identifiers and paths verbatim). Short beats complete: one screen, no
restating the task description.

1. **On pickup:** one or two lines — what this session is going to do + the branch
   name (with the task id in it). If no branch exists yet (planning-only pickup),
   say the branch comes at build time instead of inventing one. The pickup comment
   lands immediately; the status flip may come later (at plan start or first edit) —
   that window is intended.
2. **Plan ready** (if there was a planning phase): 3–6 bullets + any open decisions
   for Max. Then wait for approval before flipping to `in progress` if the plan needs
   his sign-off.
3. **End of session — always, even when unfinished.** This is the ClickUp half of
   DoD #7 (changelog entry + short ClickUp summary):
   - what changed (paths, migration yes/no) and the PR link;
   - test status as actually run — `pnpm vitest run`, pgTAP, lint, with real results,
     never "should pass";
   - for UI tasks: the numbered test handoff (dev-login link + yes/no questions) lives
     in the chat/PR per CLAUDE.md — the ClickUp comment links to the PR and says the
     handoff is waiting for Max;
   - what is left and what Max specifically needs to do (test, merge, prod-push).
4. **After merged + tested confirmation:** a final one-liner, then set `complete`.

## What this skill never does

- Never sets `cancelled`, never deletes tasks, never touches other tasks' statuses
  "while at it".
- Never marks `complete` on the session's own judgment that it is "probably fine".
- Never ends a session with ClickUp out of sync: the last action before handing back
  to Max is making the task's status + latest comment match what actually happened,
  then flipping the marker entry to `synced: true`. Deleting the marker instead of
  syncing is only legitimate for a stale marker from an earlier/crashed session whose
  task is verifiably already in sync.

CLAUDE.md remains the source of truth for *how* to build (DoD, security checklist,
review gates, changelog, test handoff format). This skill only adds the ClickUp
bookkeeping around it — if the two ever conflict, CLAUDE.md wins and this file needs
updating.
