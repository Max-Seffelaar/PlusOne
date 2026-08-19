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
# into ci.yml as its own step. The step's pass/fail IS the verdict: nothing has to
# be read out of a log by hand.
set -uo pipefail

DB=supabase/tests/database
PROOF=scripts/gate-proof
STAGED="$DB/zz_gate_proof.test.sql"
rc=0

unstage() { rm -f "$STAGED"; }
trap unstage EXIT

stage() { cp "$PROOF/$1" "$STAGED"; }

# check <exit-status-of-the-condition> <what was being claimed>
check() {
  if [ "$1" -eq 0 ]; then
    echo "  ok   — $2"
  else
    echo "  FAIL — $2"
    rc=1
  fi
}

case "${1:-}" in

  # ── The core claim: pg_prove says PASS, the gate says no. ────────────────────
  A)
    echo "=== PROOF A — a plan/run mismatch that pg_prove reports as PASS ==="
    stage mismatch.sql
    supabase test db > /tmp/bare-a.log 2>&1; bare=$?
    node scripts/db-test.mjs > /tmp/gate-a.log 2>&1; gate=$?
    unstage
    echo "--- bare \`supabase test db\` exited $bare ---"; tail -25 /tmp/bare-a.log
    echo "--- \`node scripts/db-test.mjs\` exited $gate ---"; tail -30 /tmp/gate-a.log

    [ "$bare" -eq 0 ]; check $? "bare \`supabase test db\` exits 0 on the drifted file (got $bare)"
    grep -q "Result: PASS" /tmp/bare-a.log; check $? "pg_prove printed 'Result: PASS'"
    grep -q "planned 4 tests but ran 1" /tmp/bare-a.log; check $? "the mismatch was emitted — as a TAP comment pg_prove ignored"
    [ "$gate" -eq 1 ]; check $? "the gate exits 1 on the same run (got $gate)"
    grep -q "pg_prove reported PASS, but" /tmp/gate-a.log; check $? "the gate names the contradiction"
    grep -q "plan() does not match the number of assertions it ran" /tmp/gate-a.log; check $? "the gate labels the defect"
    ;;

  # ── Finding: currval() replaced "# No tests run!" with an unrecognized error. ─
  B1)
    echo "=== PROOF B1 — no assertions, WITH the exception handler (the fix) ==="
    stage no-tests-with-handler.sql
    node scripts/db-test.mjs > /tmp/gate-b1.log 2>&1; gate=$?
    unstage
    echo "--- \`node scripts/db-test.mjs\` exited $gate ---"; tail -40 /tmp/gate-b1.log

    grep -q "# No tests run!" /tmp/gate-b1.log; check $? "pgTAP's own '# No tests run!' survives the resync block"
    grep -q "planned tests but ran none" /tmp/gate-b1.log; check $? "the gate recognizes it and names it"
    ! grep -q "currval of sequence" /tmp/gate-b1.log; check $? "no 'currval ... is not yet defined' error"
    [ "$gate" -ne 0 ]; check $? "the build is red (got $gate)"
    ;;

  B2)
    echo "=== PROOF B2 — the same file WITHOUT the handler (the pre-fix code) ==="
    stage no-tests-without-handler.sql
    node scripts/db-test.mjs > /tmp/gate-b2.log 2>&1; gate=$?
    unstage
    echo "--- \`node scripts/db-test.mjs\` exited $gate ---"; tail -40 /tmp/gate-b2.log

    grep -q "currval of sequence" /tmp/gate-b2.log; check $? "the pre-fix block dies on SQLSTATE 55000, as the review said"
    ! grep -q "# No tests run!" /tmp/gate-b2.log; check $? "and pgTAP's signal never appears — the gate has nothing to catch"
    [ "$gate" -ne 0 ]; check $? "the build is red, but for a reason nothing names (got $gate)"
    ;;

  # ── Finding: arguments were dropped. Proven against the real CLI, not a fake. ─
  D)
    echo "=== PROOF D — arguments reach the real supabase CLI ==="
    node scripts/db-test.mjs "$DB/tiers.vat.test.sql" > /tmp/gate-d.log 2>&1; gate=$?
    echo "--- exited $gate ---"; tail -20 /tmp/gate-d.log

    [ "$gate" -eq 0 ]; check $? "targeting one file succeeds (got $gate)"
    grep -qE "Files=1\b" /tmp/gate-d.log; check $? "pg_prove ran exactly 1 file, not all 56"
    grep -q "1 files /" /tmp/gate-d.log; check $? "the gate's success line reports the run it actually verified"
    ;;

  *)
    echo "usage: $0 {A|B1|B2|D}" >&2; exit 2 ;;
esac

if [ "$rc" -eq 0 ]; then echo "PROOF ${1} OK"; else echo "PROOF ${1} FAILED"; fi
exit "$rc"
