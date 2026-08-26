#!/bin/bash
# SessionStart hook for Claude Code on the web: provision a fresh container so
# lint/type-check/vitest run exactly like CI. Thin wrapper on purpose — ALL
# logic lives in scripts/session-setup.mjs, the same script ci.yml and the
# laptop call, so the setups cannot drift apart. The script's inventory (what
# runs here, what can't, and the never-weaken-the-app rule) prints to stdout,
# which Claude Code adds to the session's context.
#
# Local sessions are untouched (CLAUDE_CODE_REMOTE guard): a laptop checkout
# manages its own node_modules and must never get a surprise install at
# session start.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
exec node scripts/session-setup.mjs install
