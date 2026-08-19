#!/usr/bin/env bash
# TEMP PROOF (86eykjgrb round 2) — this whole directory is deleted in the commit
# after the CI run that executes it.
#
# The review's five reliability findings all reduce to one question: can the gate
# be shown to go red in the cases it exists to catch? Unit tests cover the wrapper
# (they spawn scripts/db-test.mjs against a fake pg_prove). They cannot cover the
# SQL side — pgTAP's counter, `currval`, `finish()` — which needs a real Postgres.
#
# So each claim below is asserted HERE, against the real local stack, and wired
# into ci.yml as its own step. Every assertion and every relevant output line is
# ALSO emitted as a GitHub workflow annotation (`::notice::` / `::error::`), so the
# verdict and the evidence are both readable from the checks API without opening a
# log — which is the only way this proof is auditable from a sandbox that cannot
# reach the log storage host.
set -uo pipefail

DB=supabase/tests/database
PROOF=scripts/gate-proof
STAGED="$DB/zz_gate_proof.test.sql"
STEP="${1:-?}"
rc=0

unstage() { rm -f "$STAGED"; }
trap unstage EXIT
stage() { cp "$PROOF/$1" "$STAGED"; }

# Annotations are one line each; strip newlines and cap the length.
ann() { # level, title, text
  printf '::%s title=%s::%s\n' "$1" "$2" "$(printf '%s' "$3" | tr '\n' ' ' | cut -c1-400)"
}
note() { ann notice "PROOF $STEP" "$1"; }
fail() { ann error "PROOF $STEP" "$1"; rc=1; }

# check <status of the claim> <the claim>
check() {
  if [ "$1" -eq 0 ]; then echo "  ok   — $2"; note "ok — $2"
  else echo "  FAIL — $2"; fail "FAILED — $2"; fi
}

# Surface the lines that decide the case, pass or fail.
evidence() { # label, file, pattern
  local n=0
  while IFS= read -r line; do
    n=$((n + 1)); [ "$n" -gt 6 ] && break
    note "$1: $line"
  done < <(grep -aE "$3" "$2" 2>/dev/null | head -6)
  [ "$n" -eq 0 ] && note "$1: (no line matched /$3/)"
  return 0
}

case "$STEP" in

  # ── The core claim: pg_prove says PASS, the gate says no. ────────────────────
  A)
    echo "=== PROOF A — a plan/run mismatch that pg_prove reports as PASS ==="
    stage mismatch.sql
    supabase test db > /tmp/bare-a.log 2>&1; bare=$?
    node scripts/db-test.mjs > /tmp/gate-a.log 2>&1; gate=$?
    unstage
    echo "--- bare \`supabase test db\` exited $bare ---"; tail -40 /tmp/bare-a.log
    echo "--- \`node scripts/db-test.mjs\` exited $gate ---"; tail -40 /tmp/gate-a.log

    note "bare \`supabase test db\` exit=$bare ; gate exit=$gate"
    evidence "bare" /tmp/bare-a.log "planned|Result:|Files=|zz_gate_proof|Dubious|not ok"
    evidence "gate" /tmp/gate-a.log "gate failed|plan\(\) does not match|planned .* but ran|✔"

    [ "$bare" -eq 0 ]; check $? "bare \`supabase test db\` exits 0 on the drifted file (got $bare)"
    grep -qa "Result: PASS" /tmp/bare-a.log; check $? "pg_prove printed 'Result: PASS'"
    grep -qaE "planned [0-9]+ tests? but ran [0-9]+" /tmp/bare-a.log; check $? "a plan/run mismatch was emitted — as a TAP comment pg_prove ignored"
    [ "$gate" -eq 1 ]; check $? "the gate exits 1 on the same run (got $gate)"
    grep -qa "pg_prove reported PASS, but" /tmp/gate-a.log; check $? "the gate names the contradiction"
    grep -qa "plan() does not match the number of assertions it ran" /tmp/gate-a.log; check $? "the gate labels the defect"
    ;;

  # ── Finding: currval() replaced "# No tests run!" with an unrecognized error. ─
  B1)
    echo "=== PROOF B1 — no assertions, WITH the exception handler (the fix) ==="
    stage no-tests-with-handler.sql
    node scripts/db-test.mjs > /tmp/gate-b1.log 2>&1; gate=$?
    unstage
    tail -40 /tmp/gate-b1.log
    note "gate exit=$gate"
    evidence "b1" /tmp/gate-b1.log "No tests run|currval|ran none|exited"

    grep -qa "# No tests run!" /tmp/gate-b1.log; check $? "pgTAP's own '# No tests run!' survives the resync block"
    grep -qa "planned tests but ran none" /tmp/gate-b1.log; check $? "the gate recognizes it and names it"
    ! grep -qa "currval of sequence" /tmp/gate-b1.log; check $? "no 'currval ... is not yet defined' error"
    [ "$gate" -ne 0 ]; check $? "the build is red (got $gate)"
    ;;

  B2)
    echo "=== PROOF B2 — the same file WITHOUT the handler (the pre-fix code) ==="
    stage no-tests-without-handler.sql
    node scripts/db-test.mjs > /tmp/gate-b2.log 2>&1; gate=$?
    unstage
    tail -40 /tmp/gate-b2.log
    note "gate exit=$gate"
    evidence "b2" /tmp/gate-b2.log "No tests run|currval|ran none|exited"

    grep -qa "currval of sequence" /tmp/gate-b2.log; check $? "the pre-fix block dies on SQLSTATE 55000, as the review said"
    ! grep -qa "# No tests run!" /tmp/gate-b2.log; check $? "and pgTAP's signal never appears — the gate has nothing to catch"
    [ "$gate" -ne 0 ]; check $? "the build is red, but for a reason nothing names (got $gate)"
    ;;

  # ── Finding: arguments were dropped. Proven against the real CLI, not a fake. ─
  D)
    echo "=== PROOF D — arguments reach the real supabase CLI ==="
    node scripts/db-test.mjs "$DB/tiers.vat.test.sql" > /tmp/gate-d.log 2>&1; gate=$?
    tail -20 /tmp/gate-d.log
    note "gate exit=$gate"
    evidence "d" /tmp/gate-d.log "Files=|files /|Result:"

    [ "$gate" -eq 0 ]; check $? "targeting one file succeeds (got $gate)"
    grep -qaE "Files=1\b" /tmp/gate-d.log; check $? "pg_prove ran exactly 1 file, not all 56"
    grep -qa "1 files /" /tmp/gate-d.log; check $? "the gate's success line reports the run it actually verified"
    ;;

  *) echo "usage: $0 {A|B1|B2|D}" >&2; exit 2 ;;
esac

if [ "$rc" -eq 0 ]; then echo "PROOF $STEP OK"; else echo "PROOF $STEP FAILED"; fi
exit "$rc"
