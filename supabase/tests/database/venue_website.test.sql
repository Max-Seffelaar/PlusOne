-- pgTAP — venues.website (20260918203700, z8uq9m0hw2).
-- The venue settings "Website" field. Proves the column exists (nullable) and
-- that the CHECK backstopping the Zod rule refuses anything that isn't an
-- http(s) URL of at most 200 chars, even on a direct write. Runs as the table
-- owner: the CHECK holds regardless of role, and the RLS on venues is unchanged
-- (venues_update_admin, covered by the existing RLS suites).

begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

select has_column('public', 'venues', 'website', 'venues.website exists');
select col_is_null('public', 'venues', 'website', 'venues.website is nullable');

-- Club Vesper (seed).
select lives_ok($$
  update public.venues set website = 'https://clubvesper.nl'
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, 'an https URL is accepted');

select lives_ok($$
  update public.venues set website = 'HTTP://clubvesper.nl/agenda'
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, 'an http URL is accepted, scheme case-insensitive');

select throws_ok($$
  update public.venues set website = 'clubvesper.nl'
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, '23514', null, 'a URL without a scheme is rejected (check_violation)');

select throws_ok($$
  update public.venues set website = 'javascript:alert(1)'
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, '23514', null, 'a non-http scheme is rejected');

select throws_ok($$
  update public.venues set website = 'https://' || repeat('a', 193)
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, '23514', null, 'a 201-char URL is rejected (max 200)');

select lives_ok($$
  update public.venues set website = null
  where id = 'aa000000-0000-7000-8000-000000000001'
$$, 'clearing the website back to null is accepted');

select * from finish();

rollback;
