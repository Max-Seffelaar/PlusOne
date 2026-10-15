---
name: linear-task
description: Drive the Linear issue lifecycle for PlusOne Guestlist work sessions. Use this skill EVERY time Max hands over work that lives in Linear — a pasted linear.app/plus-one/issue/… link, a bare key like PLU-70, "pak PLU-70 op", "werk deze issues af", "zet het issue op in progress", "rond het issue af", "update het Linear-issue" — or when a session that started from a Linear issue reaches a phase change (plan done, PR open, merged, blocked). It owns the status flow (Todo → In Progress → In Review → Merged - Testen → Done), the comments on the issue, the session marker the Stop hook checks, and the rule that Done only happens after the work is merged AND tested — never when a PR is merely opened or merged.
---

# Linear issue lifecycle

CLAUDE.md describes how to *build*; this skill owns the bookkeeping *around* an issue so
Linear always reflects reality. The ClickUp years taught the lesson twice: prose rules
load at session start, but the failure moment (the end-of-session update) comes hours
later, so the update has to be part of the same motion as the work — a marker the Stop
hook refuses to ignore. Linear replaced ClickUp on 2026-10-14 (PLU-70); ClickUp ids in
older docs, comments and commits are history and stay as they are.

## Where things live

- Workspace `plus-one`, team **PlusOne** (key `PLU`). Issue URLs look like
  `https://linear.app/plus-one/issue/PLU-70/<slug>`; the **key** (`PLU-70`) is what every
  tool, branch and PR title uses. `P-PLU-3`-style ids are projects, not issues.
- Issues are grouped in **projects** per theme (Fase 14 — Deurbetalingen, Fase 17 — Native
  apps, Admin Platform, Kwaliteit & tech debt, Billing & legal restpunten, Security &
  observability, Perf & scale, Mail & notificaties, UX & product-polish, Tractie & CRM,
  Deur: mesh & offline, Ideeën & later). A phase's "hoofdtaak" is the project description;
  its P-issues are top-level issues; T-issues are sub-issues under their P-issue. A new
  issue goes in the matching project — ask Max when none fits; `Kwaliteit & tech debt` is
  the default for repo-internal work.
- **Labels carry what the old `Model:` line carried.** Group `Model` (single-select:
  `Fable` = decisions/planning, `Opus` = building, `Sonnet` = mechanical), group
  `Milestone` (`Now` / `≥5` / `≥25` / `≥100`, the CLAUDE.md milestone rule), `high-risk`
  (RLS/triggers/SECURITY DEFINER, service_role, auth/middleware, billing webhook, door
  outbox → fresh-session `/code-review` + `/security-review` before merge), `Design`
  (needs or is a Paper design pass before build). A `Model:` line in the description is
  fine as a mirror; the label is canonical.
- **Tools:** the Linear MCP connector — `get_issue` (with `description`), `list_comments`,
  `save_issue` (state, labels, parent, project), `save_comment`. Without the connector
  (cloud container, CI, connector down) use the API-key fallback with the same four moves:
  `node scripts/linear-task.mjs get|state|comment|drift` on `LINEAR_API_KEY` (export it in
  that shell only; see `.env.example`). Never paste the key anywhere.

## The statuses

Exact state names for `save_issue` / `linear-task.mjs state`:

| status | meaning here |
|---|---|
| `Backlog` | parked, not planned — Max's state |
| `Todo` | planned, not picked up |
| `In Progress` | a session is planning or building (there is no separate planning state; the pickup comment says which) |
| `In Review` | a PR is open |
| `Merged - Testen` | the PR is merged to `main`, the test handoff / DoD evidence is not confirmed yet |
| `Done` | merged to `main` **and** tested |

`Duplicate` and `Canceled` are Max's to set — never on your own initiative; if one seems
right (the issue turns out obsolete), say so in a comment and let Max flip it.

## Step 0 — pick up the issue (before touching any code)

1. `get_issue` with `description` plus `list_comments`. The issue description is the
   assignment of record: if what Max typed in chat — or what the codebase actually
   contains — conflicts with it, surface the conflict instead of silently picking one. A
   description error with an obvious mechanical resolution (wrong path, renamed symbol)
   is flag-and-proceed in the pickup comment; anything that changes *what* is being
   built is blocked-on-Max.
2. **Concurrency check** — two sessions once built the same task in parallel and
   corrupted each other's test runs: if the status is already `In Progress` or
   `In Review`, or a recent comment / `gh pr list --state all --search "PLU-70 in:title"`
   shows another session on it, stop and ask Max before proceeding.
3. Note the `Model` label. A mismatch with the current session (e.g. a Sonnet-mechanical
   issue in a planning-model session) is worth one flagging sentence to Max, not a
   blocker — model routing is his call. An issue without a Model or Milestone label gets
   one at pickup (ask if unclear).
4. **Multiple issues handed at once:** each keeps its own status and comments. Default to
   one branch + PR per issue; combine only when they are explicitly coupled follow-ups,
   and then say so in a comment on *both*. Sub-issues of one P-issue may share a PR when
   the P-issue says so.
5. **Write the session marker** `.claude/linear-session.json` (gitignored) in the project
   root: `{"issues":[{"id":"PLU-70","synced":false}]}` — one entry per picked-up issue.
   The Stop hook (`scripts/hooks/linear-sync-check.mjs`) refuses to end the session while
   any entry has `synced: false`, so forgetting the end-of-session update is structurally
   impossible. Flip `synced` to `true` only after the end-of-session comment is posted and
   the status matches reality.
6. **Branch and PR carry the key.** Branch `claude/plu-70-<slug>` (Linear's own
   suggestion `max/plu-70-…` works too — the integration matches the key case-insensitively
   in the branch name); PR title ends with `(PLU-70)`. That is what lets Linear's GitHub
   integration attach the PR and move the status, and what makes the concurrency check and
   `drift` mechanical. **Never write `Fixes`/`Closes`/`Resolves PLU-70` in a PR title or
   body:** those magic words make the integration close the issue to `Done` at merge,
   skipping the test gate. Write `Linear: PLU-70` instead.
   **Every PR body also carries one `Test:` line** — it decides what happens at merge
   (`.github/workflows/linear-auto-done.yml`, rule in `scripts/lib/linear-auto-done.mjs`):
   - `Test: auto` — CI plus the applicable review gates are the whole test (no 🖐 or 👁
     handoff questions). At merge the issue goes to `Done` by itself; if the PR adds a
     migration it stays `Merged - Testen` until the prod push.
   - `Test: Max` — the handoff has questions only Max can answer. At merge the issue stays
     `Merged - Testen` and is assigned to Max; his "My issues" view is the test queue.
   - No `Test:` line counts as `Test: Max`. When unsure, write `Test: Max`.
   **The session that merges a PR applies this rule itself through the Linear MCP**, right
   after the merge and without waiting for the workflow: `Test: auto` without a migration →
   `Done`; with a migration → `Merged - Testen` + comment "wacht op prod-push"; `Test: Max`
   or no line → `Merged - Testen`, assigned to Max. Same comment text as the workflow
   (`scripts/lib/linear-auto-done.mjs`). The workflow is the safety net for merges no
   session sees (Max in the GitHub UI, GitHub auto-merge); if it already moved the issue,
   leave it.
7. **Session name:** the model cannot rename a session itself (`/rename` is user-only).
   At pickup, print one copy-paste-ready line so Max can make the session name match the
   issue exactly: `/rename PLU-70 <exact issue title>`.

## Status transitions — when exactly

- → `In Progress`: at pickup, the moment real work starts — a plan phase (plan mode,
  design doc, a decision Max must make; say "planfase" in the comment) or the first
  code/migration edit. Not when you merely start reading.
- → `In Review`: when the PR opens. The GitHub integration does this itself when the
  branch or PR title carries the key; set it yourself if the issue is still
  `In Progress` after the PR exists.
- → `Merged - Testen`: when the PR merges. The integration moves it when the workspace's
  "on merge" automation points at this state; if a merged PR leaves the issue in
  `In Review`, set it yourself and tell Max the automation is off.
- → `Done`: **only** when both hold — (a) the PR is merged to `main`, and (b) the work is
  tested: for UI issues Max answered the per-screen test handoff (or explicitly said it's
  good); for non-UI issues the DoD suites green plus the applicable review gates count as
  tested. A merged PR is *not* Done. If the session ends with an open or just-merged PR:
  leave it at `In Review` / `Merged - Testen`, post the end-of-session comment, and let the
  test confirmation — this session or a later one — flip it to `Done`.
  **Max never sets `Done` himself.** `Test: auto` PRs are flipped by the merge workflow.
  For everything else, any session in which Max says an issue is tested ("PLU-65 getest ✅",
  "1 ✅ 2 ✅ …", "prod gepusht" for a waiting migration) sets `Done` right then with a one-line
  comment quoting his confirmation, also when that session was started for other work.
  A ❌ answer: keep the issue at `Merged - Testen`, open a `Bug`-labelled issue (same
  project, `relatedTo` the original) with the failing question, and say so in both.
- Session ends with **zero work done** (interrupted before the first edit, no PR):
  revert to `Todo` — `In Progress` would be false and would trip the next session's
  concurrency check. Say so in the end-of-session comment.
- Blocked on input only Max can give → keep the current status, post a comment that
  names the blocker and the exact question.

Linear records the status change itself; the comment that accompanies it carries the
context (plan summary, PR link, blocker). A status change without a comment is only fine
for the `In Progress` entry moment when the pickup comment already said what's happening.

## Comments — what to post and when

Write comments in the language of the issue (Max writes these in Dutch — keep them Dutch,
code identifiers and paths verbatim). Short beats complete: one screen, no restating the
issue description.

1. **On pickup:** one or two lines — what this session is going to do + the branch name
   (with the key in it). If no branch exists yet (planning-only pickup), say the branch
   comes at build time instead of inventing one.
2. **Plan ready** (if there was a planning phase): 3–6 bullets + any open decisions for
   Max. Then wait for approval before building if the plan needs his sign-off.
3. **End of session — always, even when unfinished.** This is the Linear half of DoD #7
   (changelog entry + short issue summary):
   - what changed (paths, migration yes/no) and the PR link;
   - test status as actually run — `pnpm vitest run`, pgTAP, lint, with real results,
     never "should pass";
   - for UI issues: the numbered test handoff (dev-login link + yes/no questions) lives
     in the chat/PR per CLAUDE.md — the comment links to the PR and says the handoff is
     waiting for Max;
   - what is left and what Max specifically needs to do (test, merge, prod-push).
4. **After merged + tested confirmation:** a final one-liner, then set `Done`.

## Drift check (replaces the daily ClickUp↔GitHub reconcile)

`node scripts/linear-task.mjs drift` lists every started issue of team PLU and compares
it with GitHub: an `In Progress` issue whose PR is open or merged, an `In Review` issue
without an open PR, a `Merged - Testen` issue without a merged PR, and open PRs whose key
points at an issue that is not started. Exit code 1 on drift, so a scheduled routine can
alert on it; `.github/workflows/linear-drift.yml` runs it daily at 06:00 UTC and goes red
(GitHub notifies Max) on drift. Run it by hand after a merge train or when the board looks
off. It only
reads — fixing the statuses stays a deliberate, commented action.

## What this skill never does

- Never sets `Canceled` or `Duplicate`, never deletes issues, never touches other
  issues' statuses "while at it".
- Never marks `Done` on the session's own judgment that it is "probably fine", and never
  lets the GitHub integration do it (no closing magic words in PRs).
- Never ends a session with Linear out of sync: the last action before handing back to
  Max is making the issue's status + latest comment match what actually happened, then
  flipping the marker entry to `synced: true`. Deleting the marker instead of syncing is
  only legitimate for a stale marker from an earlier/crashed session whose issue is
  verifiably already in sync. A stale `.claude/clickup-session.json` from before the move
  is treated the same way by the hook.

CLAUDE.md remains the source of truth for *how* to build (DoD, security checklist, review
gates, changelog, test handoff format). This skill only adds the Linear bookkeeping around
it — if the two ever conflict, CLAUDE.md wins and this file needs updating.
