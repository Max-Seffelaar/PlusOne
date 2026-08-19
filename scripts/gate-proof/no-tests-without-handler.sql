-- TEMP PROOF (86eykjgrb round 2) — DELETED in the commit after this one.
--
-- The same file as zz_gate_proof_no_tests_with_handler, carrying the PRE-FIX
-- resync block (no exception handler). This is the A/B: same situation, and the
-- reviewer's claim is that this one loses the diagnostic.
--
-- Expected in the CI log:
--   * `ERROR:  currval of sequence "__tresults___numb_seq" is not yet defined in
--     this session` — the DO block aborts the transaction
--   * finish() never runs, so NO `# No tests run!` for this file
--   * the gate has nothing to name here: the pattern it was given for this exact
--     case never appears
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

-- (no assertions — the case the gate exists to catch)

do $resync$ begin
  perform _set('curr_test', currval('__tresults___numb_seq')::int);
end $resync$;

select * from finish();

rollback;
