-- pgTAP — store-review demo guard (Fase 17 S3, 86ey6bfug),
-- 20260925130000_review_demo_guard.sql.
--
-- Threat model: anyone holding the per-submission review code is signed in as
-- the demo account (fixed id de300000-…a001) and holds the anon key + its JWT,
-- so the guard has to hold against a raw POST /rest/v1/rpc/create_venue_with_owner,
-- not just the UI. Proves:
--   * the demo id is refused (42501) on both the wizard and the quick-create path,
--     and nothing is written;
--   * a normal user can still create a venue and becomes its admin;
--   * the function kept its shape: one overload, security definer, pinned
--     search_path, execute for authenticated only.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid, p_email text)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1', 'email', p_email)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(10);

-- ---------------------------------------------------------------------------
-- A. the demo account is refused, and nothing is written
-- ---------------------------------------------------------------------------

select pg_temp.login('de300000-0000-7000-8000-00000000a001', 'app-review@demo.plus-one.io');
select throws_ok(
  $$ select public.create_venue_with_owner(
       p_name => 'Demo Escape', p_address => 'x', p_venue_type => 'club',
       p_retention_months => 12, p_plan_id => null,
       p_terms_version => null) $$,
  '42501', 'this account cannot create venues',
  'T1 the demo account cannot create a venue (wizard path)');

select throws_ok(
  $$ select public.create_venue_with_owner(
       p_name => 'Demo Escape Quick', p_address => 'x', p_venue_type => 'club',
       p_retention_months => 12, p_plan_id => null, p_complete => true,
       p_terms_version => null) $$,
  '42501', 'this account cannot create venues',
  'T2 the demo account cannot create a venue (switcher quick-create path)');
reset role;

select is(
  (select count(*)::int from public.venues where name in ('Demo Escape', 'Demo Escape Quick')),
  0, 'T3 no venue row was written for the demo account');

select is(
  (select count(*)::int from public.venue_memberships
    where user_id = 'de300000-0000-7000-8000-00000000a001'
      and venue_id in (select id from public.venues where name like 'Demo Escape%')),
  0, 'T4 no membership was written for the demo account');

-- ---------------------------------------------------------------------------
-- B. a normal user is unaffected
-- ---------------------------------------------------------------------------

-- Yusuf (organizer@plusone.test) has no venue membership: the clean
-- "fresh owner" stand-in, as in onboarding.test.sql.
select pg_temp.login('44444444-4444-4444-8444-444444444444', 'organizer@plusone.test');
select set_config(
  'test.vid',
  public.create_venue_with_owner(
    p_name => 'Guard Control Venue', p_address => 'Teststraat 1', p_venue_type => 'club',
    p_retention_months => 12, p_plan_id => null,
    p_terms_version => null)::text,
  false
);
reset role;

select isnt(nullif(current_setting('test.vid', true), ''), null,
  'T5 a normal user can still create a venue');

select is(
  (select roles @> '{admin}'::public.venue_role[] from public.venue_memberships
    where venue_id = current_setting('test.vid')::uuid
      and user_id = '44444444-4444-4444-8444-444444444444'),
  true, 'T6 and still becomes its admin');

-- ---------------------------------------------------------------------------
-- C. shape unchanged: one overload, security definer, pinned search_path, ACL
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_venue_with_owner'),
  1, 'T7 exactly one create_venue_with_owner overload exists');

select is(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_venue_with_owner'),
  true, 'T8 still security definer with search_path pinned to empty');

select ok(
  has_function_privilege('authenticated',
    'public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)',
    'execute'),
  'T9 authenticated keeps execute');

select ok(
  not has_function_privilege('anon',
    'public.create_venue_with_owner(text, text, text, integer, text, text, text, text, text, boolean, text)',
    'execute'),
  'T10 anon still has no execute');

select * from finish();

rollback;
