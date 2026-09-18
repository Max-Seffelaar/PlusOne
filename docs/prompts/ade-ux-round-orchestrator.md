# Orchestrator prompt — ADE UX round (paste into a fresh Claude Code session in this repo)

Everything between the rules is the prompt. It assumes the session starts on a clean
checkout of `main` with the plan merged (`docs/plan-ade-ux-round-2026-09-17.md`).

---

Orchestrate this with subagents. You are the orchestrating session for ClickUp task
`z8uq9m0g0j` ("ADE UX-ronde — Joeri-feedback 17/9"). The complete, verified plan is
`docs/plan-ade-ux-round-2026-09-17.md` — read it in full before anything else; it is
the assignment of record (15 items A–O, six streams S1–S6, two PRs). CLAUDE.md applies in
full. Model: Opus for you and for every building sub-agent.

Do this, in this order:

0. Pick up the task with the `clickup-task` skill: read the task + comments, concurrency
   check, pickup comment in Dutch naming the branch `claude/ade-ux-round-z8uq9m0g0j`,
   write the session marker, print the `/rename` line. Status → `in progress` at the
   first code edit.
1. Environment: `node scripts/session-setup.mjs check` must be green before any change.
   Then prove the viewing harness works: `pnpm dev:fake` (background) and
   `pnpm shot home /app` must produce `.screenshots/home.png`. It is your only way to
   look at screens in a web container; pgTAP, the concurrency suite and e2e are NOT
   runnable here — never claim them, say what did not run.
2. Create the task branch from `origin/main`. Spawn five sub-agents in parallel (Agent
   tool, `isolation: "worktree"`), one per stream S1–S5, scoped exactly as the plan's
   "Execution" table. Each brief must stand alone: paste that stream's items verbatim
   from the plan (Decision / Today / Spec / Tests), its file-ownership list, the plan's
   "Ground rules" section, and the definition of done: `pnpm install --frozen-lockfile`
   in the worktree, then `pnpm lint && pnpm type-check && pnpm vitest run` green; every
   new piece of logic unit-tested; copy only in `src/lib/i18n`; new primitives in
   `kit.tsx`; `import type { JSX } from 'react'`; no file over 800 LOC grows; Capacitor
   checklist per touched screen; conventional commits on the worktree branch. Tell each
   agent to report: files changed, tests added, anything it could not do and why, and
   which screens it could not verify visually.
3. Merge the worktree branches into the task branch in the order S2 → S1 → S5 → S4 → S3.
   Resolve conflicts yourself (`guests/index.tsx` and `src/lib/i18n/surfaces/guests.ts`
   are the known hot spots). After every merge run
   `pnpm lint && pnpm type-check && pnpm vitest run` and fix before the next merge.
4. Spawn S6 (K5, database) as its own sub-agent on branch
   `claude/ade-ux-round-z8uq9m0g0j-db`: the constraint trigger + pgTAP (allowed and
   denied cases) exactly as the plan specifies; a migration timestamp that is unique
   against `origin/main`; no type regen. It cannot run pgTAP here and must say so in its
   report and in the PR body.
5. Verify visually on the merged task branch: `pnpm dev:fake`, then `pnpm shot` for every
   touched screen, desktop AND mobile, as admin and as staff where rights differ. Open
   every image (Read tool) and compare with the plan's spec. Anything off → fix, re-shoot.
6. Push both branches with `git push -u origin <branch>` and open two DRAFT PRs with the
   task id in the titles: PR 1 `feat(ux): ADE UX round — Joeri feedback 17/9, items A–O
(z8uq9m0g0j)`; PR 2 `feat(db): guests.contact_id must belong to the guest's venue
(z8uq9m0g0j)`. PR bodies: what changed per item (A–O), the screenshots, exactly which
   suites ran and which did not, and — for PR 2 — the self-contained adversarial
   security-research prompt CLAUDE.md requires (threat model stated, the migration inline,
   concrete attack questions about cross-venue `contact_id`, anonymized contacts and the
   existing RPC paths).
7. Bookkeeping: a session-end entry in `docs/changelog.md` (newest first); the ClickUp
   end-of-session comment in Dutch (changes, PR links, real test results, what Max must
   do); flip the marker to synced. The task stays `in progress` — open PRs are not
   complete.
8. End your turn with the per-screen test handoff for Max: dev-login links to the LOCAL
   stack (`http://localhost:7000/auth/dev-login?email=manager@plusone.test&next=/app`,
   `staff@` and `door@` where relevant, plus the tab/screen to open) and 10–15 numbered
   yes/no questions per stream (core action end-to-end · persists after refresh ·
   ≤ 390 px and ≥ 1280 px · empty/loading/error · permissions · the item-specific edge
   case · visual match).

Hard rules for you and every sub-agent: never weaken, skip or delete a guard test; no
new dependencies; no service-role usage; no door-outbox changes; no server-side data
work in the `/app` page; do not edit CLAUDE.md; English copy only in `src/lib/i18n`; one
adapter per entity; every new UI primitive lives in `kit.tsx`. If a plan item conflicts
with the code you find, stop that item and report the conflict in the PR and on the
ClickUp task instead of improvising a different feature. If a sub-agent reports it could
not finish, you finish it or you say so in the PR — never mark an item done that is not.

---
