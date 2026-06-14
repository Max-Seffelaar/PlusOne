-- pgTAP — Fase 9: the door realtime migration adds check_ins + guests to the
-- supabase_realtime publication so postgres_changes can stream them (decision #11).

begin;

create extension if not exists pgtap with schema extensions;

select plan(3);

select ok(
  exists (select 1 from pg_publication where pubname = 'supabase_realtime'),
  'supabase_realtime publication exists'
);

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'check_ins'
  ),
  'check_ins is published on supabase_realtime'
);

select ok(
  exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'guests'
  ),
  'guests is published on supabase_realtime'
);

select * from finish();

rollback;
