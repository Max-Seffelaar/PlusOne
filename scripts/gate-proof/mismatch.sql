-- TEMP PROOF (86eykjgrb round 2) — deleted in the commit after this one.
--
-- Purpose: make CI demonstrate, rather than assert, that the plan/run gate turns
-- a pg_prove PASS into a red build. This is the real defect in miniature, and it
-- is shaped deliberately like the file it came from (tiers.vat.test.sql): the
-- assertions that survive run FIRST, the savepoint-wrapped ones run last, and the
-- rollback is the final statement before finish().
--
-- That ordering matters. pgTAP's counter lives in the temp TABLE __tcache__ and
-- the printed numbers come from the SEQUENCE __tresults___numb_seq, and a
-- rollback-last file drifts whether ok() *increments* that counter or *assigns*
-- it from the sequence — an assertion placed after the rollback would only drift
-- under the first, which is an assumption this proof should not depend on.
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

-- Runs in the main transaction: this is the one finish() will still see.
select ok(true, 'P1 runs outside any savepoint');

savepoint p1;
select ok(true, 'P2 runs inside a savepoint');
select ok(true, 'P3 runs inside a savepoint');
select ok(true, 'P4 runs inside a savepoint');
rollback to savepoint p1;

select * from finish();

rollback;
