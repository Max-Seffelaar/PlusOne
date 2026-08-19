-- TEMP PROOF (86eykjgrb round 2) — DELETED in the commit after this one.
--
-- Purpose: make CI demonstrate, rather than assert, that the plan/run gate turns
-- a pg_prove PASS into a red build. This file is the defect in miniature: three
-- assertions run inside a savepoint that is then rolled back, so pgTAP's counter
-- (curr_test, in the temp TABLE __tcache__) reverts to 0 while the printed test
-- numbers (from the SEQUENCE __tresults___numb_seq) keep climbing.
--
-- Expected in the CI log:
--   * a complete, well-formed TAP stream: `1..4` followed by four `ok` lines
--   * `Result: PASS` from pg_prove, which is correct — the stream is fine
--   * `# Looks like you planned 4 tests but ran 1`, emitted only as a TAP comment
--   * scripts/db-test.mjs exiting 1 and naming it
--
-- Deliberately NOT carrying the resync block the three real savepoint files have.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

savepoint p1;
select ok(true, 'P1 runs inside a savepoint');
select ok(true, 'P2 runs inside a savepoint');
select ok(true, 'P3 runs inside a savepoint');
rollback to savepoint p1;

select ok(true, 'P4 runs outside the savepoint');

select * from finish();

rollback;
