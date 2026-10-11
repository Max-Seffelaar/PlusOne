-- pgTAP — user_profiles.has_joined (20261016120050): a yes/no derived from
-- terms_accepted_at, which no role can write.
--
-- Everything rolls back.

begin;

create extension if not exists pgtap with schema extensions;

create function pg_temp.login(p_user uuid)
returns void language plpgsql as $fn$
begin
  perform set_config('request.jwt.claims', json_build_object(
    'sub', p_user::text, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$fn$;

select plan(7);

select col_is_null('public', 'user_profiles', 'has_joined', 'H1 has_joined exists (nullable generated column)');
select is((select attgenerated from pg_attribute
            where attrelid = 'public.user_profiles'::regclass and attname = 'has_joined'),
  's'::"char", 'H2 has_joined is a STORED generated column');

update public.user_profiles set terms_accepted_at = null
 where id = '55555555-5555-4555-8555-555555555555';
update public.user_profiles set terms_accepted_at = '2026-06-24 12:00:00+00'
 where id = '22222222-2222-4222-8222-222222222222';

select is((select has_joined from public.user_profiles
            where id = '55555555-5555-4555-8555-555555555555'), false,
  'H3 no terms_accepted_at -> has_joined false');
select is((select has_joined from public.user_profiles
            where id = '22222222-2222-4222-8222-222222222222'), true,
  'H4 a terms_accepted_at -> has_joined true');

-- Nobody can set it directly, not even on their own row.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
select throws_ok($$ update public.user_profiles set has_joined = true
                    where id = '55555555-5555-4555-8555-555555555555' $$,
  null, null, 'H5 a user cannot write has_joined on their own row');
reset role;

select throws_ok($$ update public.user_profiles set has_joined = true
                    where id = '55555555-5555-4555-8555-555555555555' $$,
  '428C9', null, 'H6 not even the owner: it is generated');

-- It follows the source column: accepting the terms flips it.
select pg_temp.login('55555555-5555-4555-8555-555555555555');
update public.user_profiles set terms_accepted_at = now()
 where id = '55555555-5555-4555-8555-555555555555';
reset role;
select is((select has_joined from public.user_profiles
            where id = '55555555-5555-4555-8555-555555555555'), true,
  'H7 accepting the terms (own-row UPDATE) flips has_joined to true');

select * from finish();

rollback;
