#!/bin/bash
# SessionStart hook: provision the session through scripts/session-setup.mjs —
# the same script ci.yml and the laptop call, so the setups cannot drift apart.
# The script's stdout (environment inventory + the never-weaken-the-app rule)
# is added to the session's context by Claude Code.
#
#   remote (Claude Code on the web)  → install: a fresh container has no
#     node_modules, so inventory + `pnpm install --frozen-lockfile`.
#   local (laptop/worktree)          → inventory only: read-only and fast
#     (~1s) — a local checkout manages its own node_modules and must never
#     get a surprise install at session start.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  exec node scripts/session-setup.mjs install
fi
exec node scripts/session-setup.mjs inventory
