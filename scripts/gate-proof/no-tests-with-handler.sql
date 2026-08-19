-- TEMP PROOF (86eykjgrb round 2) — DELETED in the commit after this one.
--
-- Review finding: `currval()` raises SQLSTATE 55000 when no assertion ever
-- advanced the sequence, which aborted the transaction before finish() could
-- raise `# No tests run!` — replacing a signal the gate catches by name with a
-- sequence error it does not recognize, in exactly the case the gate must catch.
--
-- This file carries the FIXED resync block (with the exception handler) and runs
-- zero assertions. Compare its output with zz_gate_proof_no_tests_no_handler.
--
-- Expected in the CI log:
--   * `# No tests run!` from finish()
--   * the gate naming it: "a pgTAP file planned tests but ran none"
--   * NO "currval of sequence ... is not yet defined" for THIS file
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

-- (no assertions — the case the gate exists to catch)

do $resync$ begin
  perform _set('curr_test', currval('__tresults___numb_seq')::int);
exception when object_not_in_prerequisite_state then
  null;
end $resync$;

select * from finish();

rollback;
